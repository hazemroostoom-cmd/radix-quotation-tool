# db_fix.py
import sqlite3

DB_FILE = "quotes.db"

def fix_database():
    print(f"Connecting to database: {DB_FILE}...")
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        print("Connection successful.")

        # --- Check for existing columns ---
        cursor.execute("PRAGMA table_info(users)")
        columns = [info[1] for info in cursor.fetchall()]
        print(f"Found existing columns: {columns}")

        # --- Add 'role' column if it doesn't exist ---
        if 'role' not in columns:
            print("Column 'role' not found. Adding it...")
            cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' NOT NULL")
            print("Successfully added 'role' column.")
        else:
            print("Column 'role' already exists.")

        # --- Add 'is_approved' column if it doesn't exist ---
        if 'is_approved' not in columns:
            print("Column 'is_approved' not found. Adding it...")
            cursor.execute("ALTER TABLE users ADD COLUMN is_approved INTEGER DEFAULT 0 NOT NULL")
            print("Successfully added 'is_approved' column.")
        else:
            print("Column 'is_approved' already exists.")

        conn.commit()
        print("Database changes committed.")

    except sqlite3.Error as e:
        print(f"A database error occurred: {e}")
    finally:
        if conn:
            conn.close()
            print("Connection closed. Database fix process complete.")

if __name__ == "__main__":
    fix_database()