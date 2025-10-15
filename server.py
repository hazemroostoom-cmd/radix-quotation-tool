# server.py
# -------------------------------------------------------------------
# Smart Home Quotation - Backend Server (Fully Secured & Corrected)
# -------------------------------------------------------------------
import os
import io
import sqlite3
import json
import requests
import psycopg2
from psycopg2.extras import DictCursor
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timedelta
from pathlib import Path

# --- Flask and Security Imports ---
from flask import Flask, jsonify, request, send_file, g, send_from_directory, make_response
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from functools import wraps
from dotenv import load_dotenv

# --- Helper Library Imports ---
from collections import Counter
from jinja2 import Environment, FileSystemLoader
from PIL import Image, ImageFile
import pandas as pd

# --- Optional Integrations ---
try:
    import openai
    OPENAI_AVAILABLE = True
except Exception:
    OPENAI_AVAILABLE = False

try:
    from rembg import remove as rembg_remove
    REMBG_AVAILABLE = True
except Exception:
    REMBG_AVAILABLE = False

try:
    import pdfkit
    wkhtml_paths = [
        '/usr/bin/wkhtmltopdf', '/usr/local/bin/wkhtmltopdf',
        r'C:\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe',
        r'C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe'
    ]
    wkhtml_path = next((p for p in wkhtml_paths if os.path.exists(p)), None)
    pdfkit_config = pdfkit.configuration(wkhtmltopdf=wkhtml_path) if wkhtml_path else None
    PDFKIT_AVAILABLE = pdfkit_config is not None
except Exception:
    PDFKIT_AVAILABLE = False
    pdfkit_config = None

try:
    from weasyprint import HTML, CSS
    WEASYPRINT_AVAILABLE = True
except Exception:
    WEASYPRINT_AVAILABLE = False

# Load environment variables from .env file
load_dotenv()
ImageFile.LOAD_TRUNCATED_IMAGES = True

# ----------------------
# CONFIGURATION
# ----------------------
DB_FILE = "quotes.db"
UPLOAD_FOLDER = "uploads"
TEMPLATE_FOLDER = "." 
VAT_RATE = Decimal("0.14")
COMPANY_NAME = "Radix Tech"
COMPANY_INFO_LINE_1 = "Unit 202 - Building 34 (B) - El-Moltqa El Arabi St, Sheraton - Nozha, Cairo Governorate 11799, Egypt"
COMPANY_INFO_LINE_2 = "Phone: +219238 | Email: info@radixtechgroup.com"

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app = Flask(__name__, static_folder="public", static_url_path="")
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
app.config['SECRET_KEY'] = os.environ.get('JWT_SECRET', 'a-fallback-secret-key-for-development')

base_dir = os.path.dirname(os.path.abspath(__file__))
template_env = Environment(loader=FileSystemLoader(base_dir))
template_env.globals['timedelta'] = timedelta

# ----------------------
# DATABASE
# ----------------------


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db_url = os.environ.get('DATABASE_URL')
        if not db_url:
            # LOCAL DEVELOPMENT: Fallback to SQLite when DATABASE_URL is not set
            db = g._database = sqlite3.connect(DB_FILE)
            db.row_factory = sqlite3.Row
        else:
            # PRODUCTION: Connect to PostgreSQL on Render
            conn = psycopg2.connect(db_url)
            db = g._database = conn
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        cur = db.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user' NOT NULL,
                is_approved INTEGER DEFAULT 0 NOT NULL
            );
        """)
        try:
            cur.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' NOT NULL")
        except sqlite3.OperationalError: pass
        try:
            cur.execute("ALTER TABLE users ADD COLUMN is_approved INTEGER DEFAULT 0 NOT NULL")
        except sqlite3.OperationalError: pass
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS quotes (
                id TEXT PRIMARY KEY, 
                user_id INTEGER,
                customer_name TEXT, 
                project_name TEXT,
                quote_data TEXT NOT NULL, 
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'Draft' NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
        """)
        try:
            cur.execute("ALTER TABLE quotes ADD COLUMN user_id INTEGER")
        except sqlite3.OperationalError: pass
        try:
            cur.execute("ALTER TABLE quotes ADD COLUMN status TEXT DEFAULT 'Draft' NOT NULL")
        except sqlite3.OperationalError: pass

        cur.execute("CREATE TABLE IF NOT EXISTS device_images (model_id TEXT PRIMARY KEY, filename TEXT NOT NULL);")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT, model TEXT UNIQUE,
                description TEXT, price REAL, stock INTEGER DEFAULT 0, imageFilename TEXT,
                status TEXT DEFAULT 'Active' NOT NULL
            );
        """)
        try:
            cur.execute("ALTER TABLE products ADD COLUMN status TEXT DEFAULT 'Active' NOT NULL")
        except sqlite3.OperationalError: pass

        cur.execute("""
            CREATE TABLE IF NOT EXISTS imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT,
                imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        """)
        db.commit()

COUNTERS_FILE = "counters.json"

def get_and_increment_counter(key):
    try:
        with open(COUNTERS_FILE, "r") as f:
            counters = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        counters = {"quotation_number": 1000, "bom_reference": 500}
    counters[key] = counters.get(key, 0) + 1
    with open(COUNTERS_FILE, "w") as f:
        json.dump(counters, f, indent=4)
    return counters[key]

# ----------------------
# AUTHENTICATION DECORATOR
# ----------------------
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get('token')
        if not token:
            if request.path.startswith('/api/'):
                return jsonify({'message': 'Authentication token is missing!'}), 401
            return send_from_directory("./public", "login.html")
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            db = get_db()
            cur = db.cursor()
            cur.execute("SELECT * FROM users WHERE id = ?", (data['user_id'],))
            current_user = cur.fetchone()
            if not current_user:
                return jsonify({'message': 'User not found!'}), 401
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            if request.path.startswith('/api/'):
                return jsonify({'message': 'Token is invalid or expired!'}), 401
            resp = make_response(send_from_directory("./public", "login.html"))
            resp.set_cookie('token', '', expires=0)
            return resp
        return f(current_user, *args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get('token')
        if not token:
            return jsonify({'message': 'Authentication token is missing!'}), 401
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            if data.get('role') != 'admin':
                return jsonify({'message': 'Admin privileges required!'}), 403 
            
            db = get_db()
            cur = db.cursor()
            cur.execute("SELECT * FROM users WHERE id = ?", (data['user_id'],))
            current_user = cur.fetchone()
            if not current_user:
                return jsonify({'message': 'User not found!'}), 401
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            return jsonify({'message': 'Token is invalid or expired!'}), 401
        
        return f(current_user, *args, **kwargs)
    return decorated

# ----------------------
# HELPER FUNCTIONS
# ----------------------
def get_user_initials(name):
    """Generates 2-3 letter initials from a user's name."""
    parts = name.strip().upper().split()
    if len(parts) >= 2:
        return parts[0][0] + parts[1][0]
    elif len(parts) == 1 and len(parts[0]) > 0:
        return parts[0][:3]
    return "SYS" # Fallback for system or legacy users

def load_products_from_db():
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT category, model, description, price, stock, imageFilename, status FROM products ORDER BY category, description")
    rows = cur.fetchall()
    out = {}
    for r in rows:
        cat = r["category"] or "Uncategorized"
        if cat not in out: out[cat] = []
        image_url = f"/uploads/{r['imageFilename']}" if r["imageFilename"] else None
        out[cat].append({
            "model": r["model"], "description": r["description"],
            "price": float(r["price"] or 0.0), "stock": r["stock"] or 0, "imageUrl": image_url,
            "status": r["status"]
        })
    return out

def save_products_from_dataframe(df):
    db = get_db(); cur = db.cursor()
    def find_col(candidates):
        for c in df.columns:
            if str(c).strip().lower() in [cand.lower() for cand in candidates]: return c
        return None
    desc_col, price_col, cat_col, code_col, stock_col = (
        find_col(["Device", "Description", "Item", "Item Name"]), find_col(["Price", "Unit Price", "Cost", "Amount"]),
        find_col(["Category", "Cat"]), find_col(["Code", "Model", "SKU"]), find_col(["Stock", "Qty", "Quantity"])
    )
    if not desc_col or not price_col or not code_col:
        raise ValueError(f"Excel must have Model/Code, Description, and Price columns. Found: {list(df.columns)}")
    updated, inserted = 0, 0
    for _, row in df.iterrows():
        if pd.isna(row[code_col]): continue
        model = str(row[code_col]).strip()
        description = str(row[desc_col]).strip() if not pd.isna(row[desc_col]) else model
        category = str(row[cat_col]).strip() if cat_col and not pd.isna(row[cat_col]) else "Uncategorized"
        price = float(row[price_col]) if not pd.isna(row[price_col]) else 0.0
        stock_val = int(float(row[stock_col])) if stock_col and not pd.isna(row[stock_col]) else 0
        cur.execute("SELECT model FROM products WHERE model = ?", (model,))
def _generate_pdf_with_jinja(quote_data, customer_info, totals, quote_id=None):
    valid_until = datetime.now() + timedelta(days=5)
    template = template_env.get_template("quotation_template.html")
    
    if not quote_id:
        quote_id = f"QUO-DRAFT-{get_and_increment_counter('quotation_number')}"
        
    rendered_html = template.render(
        quote_data=quote_data, customer_info=customer_info, totals=totals,
        company_name=COMPANY_NAME, vat_rate=float(VAT_RATE * 100),
        now=datetime.now(), valid_until=valid_until, base_dir=Path(base_dir).as_uri(),
        quotation_ref=quote_id,
        bom_reference=f"BOM-{get_and_increment_counter('bom_reference')}",
        company_info_line_1=COMPANY_INFO_LINE_1,
        company_info_line_2=COMPANY_INFO_LINE_2
    )
    if PDFKIT_AVAILABLE and pdfkit_config:
        options = {'page-size': 'A4', 'margin-top': '0.5in', 'margin-right': '0.5in', 'margin-bottom': '0.5in', 'margin-left': '0.5in', 'encoding': "UTF-8", 'enable-local-file-access': None}
        return pdfkit.from_string(rendered_html, False, options=options, configuration=pdfkit_config)
    elif WEASYPRINT_AVAILABLE:
        return HTML(string=rendered_html, base_url=base_dir).write_pdf()
    raise Exception("No PDF engine found. Install pdfkit+wkhtmltopdf or WeasyPrint.")

def _generate_contract_pdf(quote_data, customer_info, totals, quote_id):
    """Generates a contract PDF using the contract_template.html"""
    template = template_env.get_template("contract_template.html")
    
    # Create the contract reference by replacing the quote prefix
    contract_ref = quote_id.replace('QUO', 'CTR', 1)

    rendered_html = template.render(
        quote_data=quote_data, 
        customer_info=customer_info, 
        totals=totals,
        company_name=COMPANY_NAME, 
        vat_rate=float(VAT_RATE * 100),
        now=datetime.now(), 
        base_dir=Path(base_dir).as_uri(),
        quotation_ref=quote_id,
        contract_ref=contract_ref,
        company_info_line_1=COMPANY_INFO_LINE_1,
        company_info_line_2=COMPANY_INFO_LINE_2
    )
    if PDFKIT_AVAILABLE and pdfkit_config:
        options = {'page-size': 'A4', 'margin-top': '0.7in', 'margin-right': '0.7in', 'margin-bottom': '0.7in', 'margin-left': '0.7in', 'encoding': "UTF-8", 'enable-local-file-access': None}
        return pdfkit.from_string(rendered_html, False, options=options, configuration=pdfkit_config)
    elif WEASYPRINT_AVAILABLE:
        return HTML(string=rendered_html, base_url=base_dir).write_pdf()
    raise Exception("No PDF engine found. Install pdfkit+wkhtmltopdf or WeasyPrint.")


# ----------------------
# PUBLIC AUTH ROUTES
# ----------------------
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json();
    if not all(k in data for k in ['name', 'email', 'password']): return jsonify({'ok': False, 'message': 'Missing fields'}), 400
    hashed_password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    db = get_db(); cur = db.cursor()
    try:
        cur.execute("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", (data['name'], data['email'], hashed_password)); db.commit()
    except sqlite3.IntegrityError: return jsonify({'ok': False, 'message': 'Email already exists'}), 409
    return jsonify({'ok': True, 'message': 'New user created! Account is pending approval.'})

@app.route('/api/auth/login', methods=['POST'])
def login():
    auth = request.get_json()
    if not auth or not auth.get('email') or not auth.get('password'): return make_response('Could not verify', 401)
    db = get_db(); cur = db.cursor()
    cur.execute("SELECT * FROM users WHERE email = ?", (auth['email'],))
    user = cur.fetchone()

    if not user or not check_password_hash(user['password'], auth['password']):
        return jsonify({'ok': False, 'message': 'Invalid credentials'}), 401

    if user['is_approved'] == 0:
        return jsonify({'ok': False, 'message': 'Account is pending admin approval.'}), 403 

    token = jwt.encode({'user_id': user['id'], 'role': user['role'], 'exp': datetime.utcnow() + timedelta(days=7)}, app.config['SECRET_KEY'], algorithm="HS256")
    resp = make_response(jsonify({'ok': True, 'user': {'id': user['id'], 'name': user['name'], 'email': user['email']}, 'redirect': '/index.html'}))
    resp.set_cookie('token', token, httponly=True, secure=False, samesite='Strict', max_age=timedelta(days=7))
    return resp

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    resp = make_response(jsonify({'ok': True, 'message': 'Logged out'})); resp.set_cookie('token', '', expires=0)
    return resp

@app.route('/api/auth/status')
@token_required
def auth_status(current_user):
    user_data = dict(current_user)
    user_data.pop('password', None)
    
    return jsonify({
        'ok': True, 
        'logged_in': True, 
        'user': user_data
    })

# ----------------------
# SECURED PAGE & API ROUTES
# ----------------------
@app.route("/")
def index(): return app.send_static_file("login.html")

@app.route("/<path:path>")
def serve_static(path):
    # This route will serve files like register.html, but not index.html or dashboard.html
    # which are protected by token_required decorators.
    if path in ["index.html", "dashboard.html"]:
        # This is a fallback. The specific routes below should catch these first.
        return index()
    return send_from_directory(app.static_folder, path)

@app.route("/index.html")
@token_required
def serve_index(current_user): return app.send_static_file("index.html")

@app.route("/dashboard.html")
@admin_required
def serve_dashboard(current_user): return app.send_static_file("dashboard.html")
    
@app.route("/uploads/<path:filename>")
@token_required
def uploaded_file(current_user, filename): return send_from_directory(app.config.get("UPLOAD_FOLDER"), filename)

@app.route("/api/products")
@token_required
def api_products(current_user): return jsonify(load_products_from_db())

@app.route("/api/packages")
@token_required
def get_packages(current_user): return jsonify({"1BR Platinum": {"MixPad M2 black L&N connection": 1}, "2BR Silver": {"MixPad 7 Ultra Silver": 1}})

@app.route("/api/update-stock", methods=["POST"])
@token_required
def update_stock(current_user):
    data = request.json; db = get_db(); cur = db.cursor()
    cur.execute("UPDATE products SET stock = ? WHERE model = ?", (data['stock'], data['model'])); db.commit()
    return jsonify({"message": "Stock updated"})
    
@app.route("/api/calculate", methods=["POST"])
@token_required
def calculate(current_user):
    d = request.json or {}
    items = d.get("items", [])
    installation = Decimal(str(d.get("installationCost", 0)))
    discount = Decimal(str(d.get("discountPercent", 0)))
    subtotal = sum(Decimal(str(i.get("price", 0))) * int(i.get("quantity", 1)) for i in items)
    
    discount_amount = (subtotal * (discount / Decimal(100))).quantize(Decimal("0.01"), ROUND_HALF_UP)
    subtotal_after_discount = subtotal - discount_amount
    taxable_base = subtotal_after_discount + installation
    vat = (taxable_base * VAT_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP)
    grand_total = taxable_base + vat

    return jsonify({
        "subtotal": float(subtotal), 
        "vat": float(vat), 
        "total": float(grand_total), 
        "discountAmount": float(discount_amount)
    })

@app.route("/api/save-quote", methods=["POST"])
@token_required
def save_quote(current_user):
    d = request.json
    db = get_db()
    cursor = db.cursor()

    # If an ID is provided, it's an update. Otherwise, generate a new semantic ID.
    if d.get("id"):
        quote_id = d.get("id")
    else:
        # --- NEW SEMANTIC ID GENERATION LOGIC (DATE FIRST) ---
        initials = get_user_initials(current_user['name'])
        date_str = datetime.now().strftime('%Y%m%d')
        id_prefix = f"QUO{date_str}{initials}"

        # Find the last sequence number for this user on this day
        cursor.execute(
            "SELECT id FROM quotes WHERE id LIKE ? ORDER BY id DESC LIMIT 1",
            (f"{id_prefix}%",)
        )
        last_quote = cursor.fetchone()

        if last_quote:
            # Extract the 3-digit sequence from the end of the ID
            last_seq_str = last_quote['id'][-3:]
            next_seq = int(last_seq_str) + 1
        else:
            next_seq = 1
        
        # Format the new ID with a 3-digit padded sequence number
        quote_id = f"{id_prefix}{next_seq:03d}"
        # --- END OF NEW LOGIC ---

    cursor.execute(
        "INSERT OR REPLACE INTO quotes (id, user_id, customer_name, project_name, quote_data) VALUES (?, ?, ?, ?, ?)",
        (quote_id, current_user['id'], d.get("customerName"), d.get("projectName"), json.dumps(d))
    )
    db.commit()
    return jsonify({"id": quote_id, "message": "Quote saved"})

@app.route("/api/load-quotes")
@token_required
def load_quotes(current_user):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT id, customer_name, project_name, timestamp, status FROM quotes WHERE user_id = ? ORDER BY timestamp DESC",
        (current_user['id'],)
    )
    return jsonify([dict(r) for r in cursor.fetchall()])

@app.route("/api/load-quote/<quote_id>")
@token_required
def load_quote(current_user, quote_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT user_id, quote_data FROM quotes WHERE id=?", (quote_id,))
    quote = cursor.fetchone()

    if not quote:
        return jsonify({"error": "not found"}), 404
    
    if current_user['role'] == 'admin' or quote['user_id'] == current_user['id']:
        return jsonify(json.loads(quote["quote_data"]))
    else:
        return jsonify({"error": "Forbidden"}), 403

@app.route("/api/upload-prices", methods=["POST"])
@admin_required
def upload_prices(current_user):
    if 'prices_file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['prices_file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    filename = secure_filename(file.filename); saved_name = f"prices_{int(datetime.now().timestamp())}_{filename}"; save_path = os.path.join(UPLOAD_FOLDER, saved_name); file.save(save_path)
    try:
        df = pd.read_excel(save_path); inserted, updated = save_products_from_dataframe(df)
        db = get_db(); cur = db.cursor(); cur.execute("INSERT INTO imports (filename) VALUES (?)", (saved_name,)); db.commit()
        return jsonify({"message": "ok", "products": load_products_from_db(), "stats": {"inserted": inserted, "updated": updated}})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route("/api/clear-catalog", methods=["POST"])
@admin_required
def clear_catalog(current_user):
    db = get_db(); cur = db.cursor(); cur.execute("DELETE FROM products"); cur.execute("DELETE FROM device_images"); db.commit()
    return jsonify({"message": "Catalog cleared successfully"})

@app.route("/api/upload-image/<model_id>", methods=["POST"])
@token_required
def upload_image(current_user, model_id):
    if 'image' not in request.files: return jsonify({"error": "No image file provided"}), 400
    file = request.files['image']; filename = secure_filename(f"{model_id}_{int(datetime.now().timestamp())}.png"); filepath = os.path.join(UPLOAD_FOLDER, filename); raw = file.read()
    try:
        if REMBG_AVAILABLE:
            with open(filepath, "wb") as f: f.write(rembg_remove(raw))
        else:
            img = Image.open(io.BytesIO(raw)).convert("RGBA"); datas = img.getdata(); newData = [(255, 255, 255, 0) if item[0] > 240 and item[1] > 240 and item[2] > 240 else item for item in datas]; img.putdata(newData); img.save(filepath, "PNG")
    except Exception:
        with open(filepath, "wb") as f: f.write(raw)
    db = get_db(); cur = db.cursor(); cur.execute("INSERT OR REPLACE INTO device_images (model_id, filename) VALUES (?, ?)", (model_id, filename)); cur.execute("UPDATE products SET imageFilename = ? WHERE model = ?", (filename, model_id)); db.commit()
    return jsonify({"message": "uploaded", "imageUrl": f"/uploads/{filename}"})

@app.route("/api/export-pdf", methods=["POST"])
@token_required
def export_pdf(current_user):
    try:
        data = request.json
        items = data.get("quoteData", [])
        installation = Decimal(str(data.get("installationCost", 0)))
        discount = Decimal(str(data.get("discountPercent", 0)))
        subtotal = sum(Decimal(str(i.get("price", 0))) * int(i.get("quantity", 1)) for i in items)
        
        discount_amount = (subtotal * (discount / Decimal(100))).quantize(Decimal("0.01"), ROUND_HALF_UP)
        subtotal_after_discount = subtotal - discount_amount
        taxable_base = subtotal_after_discount + installation
        vat = (taxable_base * VAT_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP)
        grand_total = taxable_base + vat

        totals = {
            "subtotal": float(subtotal),
            "installation": float(installation),
            "discountPercent": float(discount),
            "discountAmount": float(discount_amount),
            "vat": float(vat),
            "total": float(grand_total)
        }
        
        pdf_bytes = _generate_pdf_with_jinja(items, data.get("customerInfo", {}), totals)
        
        response = make_response(pdf_bytes)
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = f'inline; filename=quotation_{data.get("customerInfo", {}).get("project", "project")}.pdf'
        return response
    except Exception as e: 
        print(f"Error in export_pdf: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/user/quote-pdf/<quote_id>", methods=['GET'])
@token_required
def get_user_quote_pdf(current_user, quote_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT user_id, quote_data FROM quotes WHERE id=?", (quote_id,))
    quote_row = cursor.fetchone()

    if not quote_row:
        return jsonify({"error": "Quote not found"}), 404
    
    if quote_row['user_id'] != current_user['id']:
        return jsonify({"error": "Forbidden"}), 403

    try:
        quote_json = json.loads(quote_row["quote_data"])
        items = quote_json.get("items", [])
        installation = Decimal(str(quote_json.get("installationCost", 0)))
        discount = Decimal(str(quote_json.get("discountPercent", 0)))
        subtotal = sum(Decimal(str(i.get("price", 0))) * int(i.get("quantity", 1)) for i in items)
        
        discount_amount = (subtotal * (discount / Decimal(100))).quantize(Decimal("0.01"), ROUND_HALF_UP)
        subtotal_after_discount = subtotal - discount_amount
        taxable_base = subtotal_after_discount + installation
        vat = (taxable_base * VAT_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP)
        grand_total = taxable_base + vat

        totals = {
            "subtotal": float(subtotal),
            "installation": float(installation),
            "discountPercent": float(discount),
            "discountAmount": float(discount_amount),
            "vat": float(vat),
            "total": float(grand_total)
        }
        customer_info = {
            "name": quote_json.get("customerName"),
            "project": quote_json.get("projectName")
        }
        pdf_bytes = _generate_pdf_with_jinja(items, customer_info, totals, quote_id=quote_id)
        
        response = make_response(pdf_bytes)
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = f'attachment; filename=quotation_{customer_info.get("project", "project")}_{quote_id}.pdf'
        return response

    except Exception as e:
        print(f"Error generating PDF for quote {quote_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/generate-email", methods=["POST"])
@token_required
def generate_email(current_user):
    data = request.json; customer = data.get("customerName", "Customer"); project = data.get("projectName", "your project"); totals = data.get("totals", {}); tone = data.get("tone", "professional")
    total_val = totals.get("total", 0)
    if OPENAI_AVAILABLE and os.getenv("OPENAI_API_KEY"):
        try:
            client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            resp = client.chat.completions.create(model="gpt-3.5-turbo", messages=[
                {"role": "system", "content": "You are an assistant writing concise, professional sales emails for quotes."},
                {"role": "user", "content": f"Customer: {customer}, Project: {project}, Total: {total_val:,.2f}, Tone: {tone}. Write the email body."}
            ])
            return jsonify({"emailBody": resp.choices[0].message.content.strip()})
        except Exception as e: print(f"OpenAI failed: {e}")
    body = f"Dear {customer},\n\nPlease find attached the quotation for \"{project}\". The total is ${total_val:,.2f}.\n\nSincerely,\n{COMPANY_NAME}"
    return jsonify({"emailBody": body})

@app.route("/api/send-email", methods=["POST"])
@token_required
def send_email(current_user):
    return jsonify({"error": "Email sending is not configured on this server."}), 501

# ----------------------
# SECURED ADMIN API ROUTES
# ----------------------
@app.route("/api/dashboard-stats")
@admin_required
def get_dashboard_stats(current_user):
    db = get_db(); cursor = db.cursor()
    cursor.execute("SELECT model, description, stock FROM products ORDER BY stock ASC")
    all_products = [dict(row) for row in cursor.fetchall()]
    cursor.execute("SELECT quote_data, timestamp FROM quotes")
    all_quotes = cursor.fetchall()
    product_counter, monthly_total, quotes_this_month = Counter(), 0, 0
    current_month_str = datetime.now().strftime('%Y-%m')
    for quote in all_quotes:
        try:
            quote_data = json.loads(quote["quote_data"])
            items = quote_data.get("items", [])
            for item in items:
                if item.get("model"): product_counter[item["model"]] += int(item.get("quantity", 0))
            
            quote_timestamp = datetime.strptime(quote["timestamp"], '%Y-%m-%d %H:%M:%S')
            if quote_timestamp.strftime('%Y-%m') == current_month_str:
                quotes_this_month += 1
                installation = Decimal(str(quote_data.get("installationCost", 0)))
                discount = Decimal(str(quote_data.get("discountPercent", 0)))
                subtotal = sum(Decimal(str(i.get("price", 0))) * int(i.get("quantity", 1)) for i in items)
                discount_amount = subtotal * (discount / Decimal(100))
                subtotal_after_discount = subtotal - discount_amount
                taxable_base = subtotal_after_discount + installation
                vat = taxable_base * VAT_RATE
                grand_total = taxable_base + vat
                monthly_total += grand_total
        except (json.JSONDecodeError, TypeError, ValueError, KeyError):
            continue 
            
    top_products_list = []
    if product_counter:
        top_5_models = product_counter.most_common(5)
        model_keys = [model for model, count in top_5_models]
        if model_keys:
            placeholders = ','.join('?' * len(model_keys))
            cursor.execute(f"SELECT model, description FROM products WHERE model IN ({placeholders})", model_keys)
            product_details = {row['model']: row['description'] for row in cursor.fetchall()}
            for model, count in top_5_models:
                top_products_list.append({"model": model, "description": product_details.get(model, "N/A"), "count": count})
    return jsonify({"all_products": all_products, "top_products": top_products_list, "monthly_stats": {"total_value": float(monthly_total), "quote_count": quotes_this_month}})

@app.route("/api/admin/all-quotes")
@admin_required
def get_all_quotes(current_user):
    db = get_db()
    cursor = db.cursor()
    query = """
        SELECT 
            q.id, 
            q.customer_name, 
            q.project_name, 
            q.timestamp, 
            q.status,
            COALESCE(u.name, 'System/Legacy') as user_name 
        FROM quotes q 
        LEFT JOIN users u ON q.user_id = u.id 
        ORDER BY q.timestamp DESC
    """
    cursor.execute(query)
    quotes = [dict(row) for row in cursor.fetchall()]
    return jsonify(quotes)

@app.route("/api/admin/quote-pdf/<quote_id>", methods=['GET'])
@admin_required
def get_quote_pdf(current_user, quote_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT quote_data FROM quotes WHERE id=?", (quote_id,))
    quote_row = cursor.fetchone()

    if not quote_row:
        return jsonify({"error": "Quote not found"}), 404
    
    try:
        quote_json = json.loads(quote_row["quote_data"])
        items = quote_json.get("items", [])
        installation = Decimal(str(quote_json.get("installationCost", 0)))
        discount = Decimal(str(quote_json.get("discountPercent", 0)))
        subtotal = sum(Decimal(str(i.get("price", 0))) * int(i.get("quantity", 1)) for i in items)
        
        discount_amount = (subtotal * (discount / Decimal(100))).quantize(Decimal("0.01"), ROUND_HALF_UP)
        subtotal_after_discount = subtotal - discount_amount
        taxable_base = subtotal_after_discount + installation
        vat = (taxable_base * VAT_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP)
        grand_total = taxable_base + vat

        totals = {
            "subtotal": float(subtotal),
            "installation": float(installation),
            "discountPercent": float(discount),
            "discountAmount": float(discount_amount),
            "vat": float(vat),
            "total": float(grand_total)
        }
        customer_info = {
            "name": quote_json.get("customerName"),
            "project": quote_json.get("projectName")
        }
        pdf_bytes = _generate_pdf_with_jinja(items, customer_info, totals, quote_id=quote_id)
        
        response = make_response(pdf_bytes)
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = f'attachment; filename=quotation_{customer_info.get("project", "project")}_{quote_id}.pdf'
        return response

    except Exception as e:
        print(f"Error generating PDF for quote {quote_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/quote/confirm/<quote_id>", methods=['POST'])
@admin_required
def confirm_quote_and_deduct_stock(current_user, quote_id):
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT quote_data, status FROM quotes WHERE id=?", (quote_id,))
    quote_row = cursor.fetchone()
    if not quote_row:
        return jsonify({"error": "Quote not found"}), 404
    if quote_row['status'] == 'Confirmed':
        return jsonify({"error": "This quote has already been confirmed and stock deducted."}), 409

    try:
        quote_json = json.loads(quote_row["quote_data"])
        items = quote_json.get("items", [])
        if not items:
            return jsonify({"error": "Cannot confirm an empty quote."}), 400

        db.execute('BEGIN TRANSACTION')

        for item in items:
            model = item.get("model")
            quantity = int(item.get("quantity", 0))
            cursor.execute("SELECT stock FROM products WHERE model = ?", (model,))
            product = cursor.fetchone()
            if not product or product['stock'] < quantity:
                db.rollback()
                return jsonify({
                    "error": f"Insufficient stock for {item.get('description', model)}. Required: {quantity}, Available: {product['stock'] if product else 0}."
                }), 400
        
        for item in items:
            model = item.get("model")
            quantity = int(item.get("quantity", 0))
            cursor.execute("UPDATE products SET stock = stock - ? WHERE model = ?", (quantity, model))

        cursor.execute("UPDATE quotes SET status = 'Confirmed' WHERE id = ?", (quote_id,))
        
        db.commit()
        return jsonify({"message": f"Quote {quote_id} confirmed. Stock has been deducted."})

    except Exception as e:
        db.rollback()
        print(f"Error during stock deduction for quote {quote_id}: {e}")
        return jsonify({"error": "A server error occurred during transaction."}), 500

@app.route("/api/user/generate-contract/<quote_id>", methods=['GET'])
@token_required
def generate_user_contract(current_user, quote_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT user_id, quote_data, status FROM quotes WHERE id=?", (quote_id,))
    quote_row = cursor.fetchone()

    if not quote_row:
        return jsonify({"error": "Quote not found"}), 404
    
    if quote_row['user_id'] != current_user['id']:
        return jsonify({"error": "Forbidden. You do not own this quote."}), 403

    if quote_row['status'] != 'Confirmed':
        return jsonify({"error": "Can only generate contracts for 'Confirmed' quotations."}), 403
    
    try:
        quote_json = json.loads(quote_row["quote_data"])
        items = quote_json.get("items", [])
        installation = Decimal(str(quote_json.get("installationCost", 0)))
        discount = Decimal(str(quote_json.get("discountPercent", 0)))
        subtotal = sum(Decimal(str(i.get("price", 0))) * int(i.get("quantity", 1)) for i in items)
        
        discount_amount = (subtotal * (discount / Decimal(100))).quantize(Decimal("0.01"), ROUND_HALF_UP)
        subtotal_after_discount = subtotal - discount_amount
        taxable_base = subtotal_after_discount + installation
        vat = (taxable_base * VAT_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP)
        grand_total = taxable_base + vat

        totals = {
            "subtotal": float(subtotal), "installation": float(installation),
            "discountPercent": float(discount), "discountAmount": float(discount_amount),
            "vat": float(vat), "total": float(grand_total)
        }
        customer_info = { "name": quote_json.get("customerName"), "project": quote_json.get("projectName") }
        
        pdf_bytes = _generate_contract_pdf(items, customer_info, totals, quote_id)
        
        project_name = customer_info.get("project", "project").replace(" ", "_")
        response = make_response(pdf_bytes)
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = f'attachment; filename=Contract_{project_name}_{quote_id}.pdf'
        return response

    except Exception as e:
        print(f"Error generating contract for quote {quote_id}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/generate-contract/<quote_id>", methods=['GET'])
@admin_required
def generate_contract(current_user, quote_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT quote_data, status FROM quotes WHERE id=?", (quote_id,))
    quote_row = cursor.fetchone()

    if not quote_row:
        return jsonify({"error": "Quote not found"}), 404
    if quote_row['status'] != 'Confirmed':
        return jsonify({"error": "Can only generate contracts for 'Confirmed' quotations."}), 403
    
    try:
        quote_json = json.loads(quote_row["quote_data"])
        items = quote_json.get("items", [])
        installation = Decimal(str(quote_json.get("installationCost", 0)))
        discount = Decimal(str(quote_json.get("discountPercent", 0)))
        subtotal = sum(Decimal(str(i.get("price", 0))) * int(i.get("quantity", 1)) for i in items)
        
        discount_amount = (subtotal * (discount / Decimal(100))).quantize(Decimal("0.01"), ROUND_HALF_UP)
        subtotal_after_discount = subtotal - discount_amount
        taxable_base = subtotal_after_discount + installation
        vat = (taxable_base * VAT_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP)
        grand_total = taxable_base + vat

        totals = {
            "subtotal": float(subtotal), "installation": float(installation),
            "discountPercent": float(discount), "discountAmount": float(discount_amount),
            "vat": float(vat), "total": float(grand_total)
        }
        customer_info = { "name": quote_json.get("customerName"), "project": quote_json.get("projectName") }
        
        pdf_bytes = _generate_contract_pdf(items, customer_info, totals, quote_id)
        
        project_name = customer_info.get("project", "project").replace(" ", "_")
        response = make_response(pdf_bytes)
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = f'attachment; filename=Contract_{project_name}_{quote_id}.pdf'
        return response

    except Exception as e:
        print(f"Error generating contract for quote {quote_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/product", methods=["POST"])
@admin_required
def add_product(current_user):
    data = request.json; db = get_db(); cur = db.cursor()
    try:
        cur.execute("INSERT INTO products (model, description, category, price, stock, status) VALUES (?, ?, ?, ?, ?, ?)", 
                    (data["model"], data["description"], data["category"], float(data["price"]), int(data["stock"]), data.get("status", "Active")))
        db.commit()
        return jsonify({"message": f"Product {data['model']} added."}), 201
    except sqlite3.IntegrityError: return jsonify({"error": f"Model '{data['model']}' already exists."}), 409

@app.route("/api/admin/product/<model_id>", methods=["PUT"])
@admin_required
def update_product(current_user, model_id):
    data = request.json; db = get_db(); cur = db.cursor()
    cur.execute("UPDATE products SET description=?, category=?, price=?, stock=?, status=? WHERE model=?", 
                (data.get("description"), data.get("category"), float(data.get("price", 0)), int(data.get("stock", 0)), data.get("status", "Active"), model_id))
    db.commit()
    return jsonify({"message": f"Product {model_id} updated."})

@app.route("/api/admin/product/<model_id>", methods=["DELETE"])
@admin_required
def delete_product(current_user, model_id):
    db = get_db(); cur = db.cursor(); cur.execute("DELETE FROM products WHERE model = ?", (model_id,)); db.commit()
    return jsonify({"message": f"Product {model_id} deleted."})

@app.route("/api/admin/users", methods=["GET"])
@admin_required
def get_users(current_user):
    if not current_user:
        return jsonify({"error": "Current user not found in token."}), 401
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name, email, role, is_approved FROM users ORDER BY is_approved ASC, name ASC")
    users = [dict(row) for row in cursor.fetchall()]
    current_user_dict = dict(current_user)
    return jsonify({
        "users": users,
        "currentUserId": current_user_dict['id']
    })

@app.route("/api/admin/user", methods=["POST"])
@admin_required
def add_user(current_user):
    data = request.get_json()
    if not all(k in data for k in ['name', 'email', 'password', 'role']):
        return jsonify({'error': 'Missing required fields: name, email, password, role.'}), 400
    
    if data['role'] not in ['admin', 'user']:
        return jsonify({'error': 'Invalid role specified. Must be "admin" or "user".'}), 400

    hashed_password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (name, email, password, role, is_approved) VALUES (?, ?, ?, ?, 1)",
            (data['name'], data['email'], hashed_password, data['role'])
        )
        db.commit()
        return jsonify({"message": "User created successfully."}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "A user with this email already exists."}), 409

@app.route("/api/admin/user/<int:user_id>", methods=["PUT"])
@admin_required
def update_user(current_user, user_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid data"}), 400

    db = get_db()
    cursor = db.cursor()

    fields_to_update = []
    params = []

    if 'name' in data and data['name']:
        fields_to_update.append("name = ?")
        params.append(data['name'])
    if 'email' in data and data['email']:
        fields_to_update.append("email = ?")
        params.append(data['email'])
    
    if 'role' in data and data['role']:
        if data['role'] not in ['admin', 'user']:
            return jsonify({"error": 'Invalid role specified.'}), 400
        if current_user['id'] == user_id and data['role'] == 'user':
            return jsonify({"error": "You cannot remove your own admin privileges."}), 403
        fields_to_update.append("role = ?")
        params.append(data['role'])

    if 'password' in data and data['password']:
        hashed_password = generate_password_hash(data['password'], method='pbkdf2:sha256')
        fields_to_update.append("password = ?")
        params.append(hashed_password)

    if not fields_to_update:
        return jsonify({"error": "No fields to update"}), 400

    params.append(user_id)
    query = f"UPDATE users SET {', '.join(fields_to_update)} WHERE id = ?"

    try:
        cursor.execute(query, tuple(params))
        db.commit()
        return jsonify({"message": f"User {user_id} updated successfully."})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already exists."}), 409

@app.route("/api/admin/user/<int:user_id>", methods=["DELETE"])
@admin_required
def delete_user(current_user, user_id):
    if current_user['id'] == user_id:
        return jsonify({"error": "You cannot delete your own account."}), 403
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    if cursor.rowcount == 0:
        return jsonify({"error": "User not found."}), 404
    return jsonify({"message": f"User {user_id} deleted successfully."})

@app.route("/api/admin/user/approve/<int:user_id>", methods=['POST'])
@admin_required
def approve_user(current_user, user_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("UPDATE users SET is_approved = 1 WHERE id = ?", (user_id,))
    db.commit()
    if cursor.rowcount == 0:
        return jsonify({"error": "User not found."}), 404
    return jsonify({"message": f"User {user_id} approved successfully."})

@app.route("/api/admin/bulk-link-images", methods=['POST'])
@admin_required
def bulk_link_images(current_user):
    upload_path = Path(app.config['UPLOAD_FOLDER'])
    if not upload_path.is_dir():
        return jsonify({"error": "Upload folder not found"}), 500

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT model FROM products WHERE model IS NOT NULL")
    products = cursor.fetchall()
    product_map = {prod['model'].replace(' ', '_'): prod['model'] for prod in products}

    supported_extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
    image_files = [f for f in upload_path.iterdir() if f.is_file() and f.suffix.lower() in supported_extensions]

    updates_to_commit = []

    for image_file in image_files:
        file_stem = image_file.stem
        
        matching_prefix = None
        for prefix in sorted(product_map.keys(), key=len, reverse=True):
            if file_stem.startswith(prefix):
                matching_prefix = prefix
                break

        if matching_prefix:
            original_model_name = product_map[matching_prefix]
            updates_to_commit.append((image_file.name, original_model_name))
            del product_map[matching_prefix]

    if updates_to_commit:
        try:
            cursor.executemany("UPDATE products SET imageFilename = ? WHERE model = ?", updates_to_commit)
            db.commit()
            linked_count = len(updates_to_commit)
            updated_models = [model for _, model in updates_to_commit]
            
            return jsonify({
                "ok": True,
                "message": f"Successfully linked {linked_count} images.",
                "updated_models": updated_models
            })
        except Exception as e:
            db.rollback()
            print(f"Database error during bulk update: {e}")
            return jsonify({"error": "A database error occurred during the update."}), 500

    return jsonify({
        "ok": False,
        "message": "No new images were linked. Ensure filenames match product models (e.g., 'Model_Name_Serial.jpg')."
    })

# ----------------------
# MAIN
# ----------------------
if __name__ == "__main__":
    init_db()
    app.run(host='0.0.0.0', port=5001, debug=True)
