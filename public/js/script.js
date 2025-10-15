// --- Authentication Check ---
// This runs first to ensure the user is logged in and to set up the UI based on role.
fetch('/api/auth/status')
    .then(res => {
        if (!res.ok) {
            window.location.href = '/login.html'; // Not logged in, redirect.
            return Promise.reject('Not authenticated');
        }
        return res.json();
    })
    .then(data => {
        if (!data.logged_in) {
            window.location.href = '/login.html';
        } else {
            const user = data.user;
            // --- START: ROLE-BASED UI LOGIC ---
            const userNameEl = document.querySelector('#user-name');
            const dashboardBtn = document.getElementById('dashboard-btn');
            const adminPanelBtn = document.getElementById('admin-panel-btn');
            const clearCatalogBtn = document.getElementById('clear-catalog-btn');
            const importPricesBtn = document.getElementById('import-prices-ui-btn');
            const bulkLinkImagesBtn = document.getElementById('bulk-link-images-btn');

            if (userNameEl) {
                userNameEl.textContent = user.name;
            }

            if (user.role !== 'admin') {
                if (dashboardBtn) dashboardBtn.style.display = 'none';
                if (adminPanelBtn) adminPanelBtn.style.display = 'none';
                if (clearCatalogBtn) clearCatalogBtn.style.display = 'none';
                if (importPricesBtn) importPricesBtn.style.display = 'none';
                if (bulkLinkImagesBtn) bulkLinkImagesBtn.style.display = 'none';
            }
            // --- END: ROLE-BASED UI LOGIC ---
        }
    })
    .catch(error => {
        if (error !== 'Not authenticated') {
            console.error('Authentication check failed:', error);
            window.location.href = '/login.html';
        }
    });

// --- Main Application Logic ---
document.addEventListener("DOMContentLoaded", () => {
 
    // ----------------------
    // STATE
    // ----------------------
    let products = {};
    let packages = {};
    let quoteItems = [];
    let currentQuoteId = null;
    let currentProductForImageUpload = null;
    let renderTimeout = null;
    let allProductsFlat = [];

    // ----------------------
    // ELEMENTS
    // ----------------------
    const productListEl = document.getElementById("product-list-container");
    const skeletonLoader = document.getElementById("skeleton-loader");
    const searchInput = document.getElementById("search-products");
    const filterCategory = document.getElementById("filter-category");
    const sortSelect = document.getElementById("sort-products");
    const importPricesBtn = document.getElementById("import-prices-ui-btn");
    const pricesFileInput = document.getElementById("prices-file-input");
    const clearCatalogBtn = document.getElementById("clear-catalog-btn");
    const bulkLinkImagesBtn = document.getElementById("bulk-link-images-btn");
    const packagesDropdown = document.getElementById("packages-dropdown");
    const addPackageBtn = document.getElementById("add-package-btn");
    const quotePanel = document.querySelector(".quote-panel");
    const tableBody = document.querySelector("#quotation-table tbody");
    const emptyQuoteEl = document.getElementById("empty-quote");
    const customerNameInput = document.getElementById("customer-name");
    const projectNameInput = document.getElementById("project-name");
    const installationInput = document.getElementById("installation-cost");
    const discountInput = document.getElementById("discount-input");
    const subtotalVal = document.getElementById("subtotal-val");
    const vatVal = document.getElementById("vat-val");
    const totalVal = document.getElementById("total-val");
    const clearQuoteBtn = document.getElementById("clear-quote-btn");
    const saveQuoteBtn = document.getElementById("save-quote-btn");
    const loadQuoteBtn = document.getElementById("load-quote-btn");
    const exportPdfBtn = document.getElementById("export-pdf-btn");
    const sendEmailBtn = document.getElementById("send-email-btn");
    const toastContainer = document.getElementById("toast-container");
    const darkModeToggle = document.getElementById("toggle-dark-mode");
    const logoutBtn = document.getElementById('logout-btn');
    const toggleCatalogBtn = document.getElementById('toggle-catalog-btn');

    // Modals
    const emailModal = document.getElementById("email-modal");
    const loadModal = document.getElementById("load-quote-modal");
    const imageUploadModal = document.getElementById("image-upload-modal");
    const adminModal = document.getElementById("admin-modal");
    const savedQuotesList = document.getElementById('saved-quotes-list');
    const imageFileInput = document.getElementById("image-file-input");
    const selectImageBtn = document.getElementById("select-image-btn");
    const imagePreview = document.getElementById("image-preview");

    // Admin Panel Elements
    const adminPanelBtn = document.getElementById("admin-panel-btn");
    const adminModalCancelBtn = document.getElementById("admin-modal-cancel");
    const adminProductForm = document.getElementById("admin-product-form");
    const adminFormClearBtn = document.getElementById("admin-form-clear-btn");
    const adminProductTableBody = document.querySelector("#admin-product-table tbody");
    const adminFormMode = document.getElementById("admin-form-mode");
    const adminModelInput = document.getElementById("admin-model");

    // User's Saved Quotes Panel Elements
    const userQuotesWidget = document.getElementById("user-quotes-widget");
    const toggleUserQuotesBtn = document.getElementById("toggle-user-quotes-btn");
    const userQuotesTableBody = document.getElementById("user-quotes-table-body");

    // ----------------------
    // API & CORE LOGIC
    // ----------------------
    const apiRequest = async (url, options = {}) => {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
            }
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                return response.json();
            }
            return response;
        } catch (e) {
            console.error("API Request Failed:", e);
            showToast(e.message, "error");
            throw e;
        }
    };

    const loadProducts = async () => {
        try {
            products = await apiRequest("/api/products");
            allProductsFlat = Object.entries(products).flatMap(([category, items]) => items.map(item => ({ ...item, category })));
            renderProducts();
            populateCategoryFilter();
        } catch (e) {
            console.error("Failed to load products:", e);
        }
    };

    const loadPackages = async () => {
        try {
            packages = await apiRequest("/api/packages");
            populatePackagesDropdown();
        } catch (e) {
            console.error("Failed to load packages:", e);
        }
    };

    const showToast = (message, type = "success") => {
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.remove();
        }, 4000);
    };
    
    const downloadBlob = (blob, filename) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    };

    // ----------------------
    // PRICE IMPORT
    // ----------------------
    const handlePriceImport = async (file) => {
        if (!file) return;
        const formData = new FormData();
        formData.append('prices_file', file);
        
        showToast("Importing prices...", "success");

        try {
            const result = await apiRequest("/api/upload-prices", {
                method: "POST",
                body: formData,
            });
        
            const { inserted, updated } = result.stats;
            showToast(`Import successful! ${inserted} new products added, ${updated} products updated.`, "success");
            await loadProducts();
        } catch (e) { /* Error handled by apiRequest */ }
    };
    
    // ----------------------
    // USER SAVED QUOTES
    // ----------------------
    const loadAndRenderUserQuotes = async () => {
        if (!userQuotesTableBody) return;
        try {
            const quotes = await apiRequest('/api/load-quotes');
            if (quotes.length === 0) {
                userQuotesTableBody.innerHTML = `<tr><td colspan="4">You have no saved quotations.</td></tr>`;
                return;
            }
            userQuotesTableBody.innerHTML = quotes.map(q => {
                const isConfirmed = q.status === 'Confirmed';
                let actionsHtml = `
                    <button class="btn-secondary load-user-quote-btn" title="Load Quote" data-quote-id="${q.id}"><i class="fas fa-folder-open"></i></button>
                    <button class="btn-secondary download-user-quote-btn" title="Download Quotation PDF" data-quote-id="${q.id}" data-project-name="${q.project_name || 'project'}"><i class="fas fa-file-pdf"></i></button>
                `;
                if (isConfirmed) {
                    actionsHtml += `
                        <button class="btn-primary generate-user-contract-btn" title="Generate Contract PDF" data-quote-id="${q.id}" data-project-name="${q.project_name || 'project'}">
                            <i class="fas fa-file-signature"></i> Contract
                        </button>
                    `;
                }

                return `
                <tr class="quote-row ${isConfirmed ? 'confirmed-quote' : ''}" data-quote-id="${q.id}">
                    <td data-label="Project">${q.project_name || 'Untitled Project'}</td>
                    <td data-label="Customer">${q.customer_name || 'N/A'}</td>
                    <td data-label="Date Saved">${new Date(q.timestamp).toLocaleString()}</td>
                    <td data-label="Actions" class="admin-actions">
                        ${actionsHtml}
                    </td>
                </tr>`
            }).join('');
        } catch (e) {
            userQuotesTableBody.innerHTML = `<tr><td colspan="4">Error loading your quotations.</td></tr>`;
        }
    };

    // ----------------------
    // PRODUCT CATALOG
    // ----------------------
    const renderProducts = () => {
        if (!productListEl) return;
        
        productListEl.innerHTML = "";
        skeletonLoader.style.display = 'grid';

        const searchTerm = (searchInput.value || '').toLowerCase();
        const categoryFilterValue = filterCategory.value;
        const [sortBy, sortDir] = (sortSelect.value || "name_asc").split('_');

        let filtered = allProductsFlat.filter(p => {
            const nameMatch = (p.description && p.description.toLowerCase().includes(searchTerm)) ||
                (p.model && p.model.toLowerCase().includes(searchTerm));
            const categoryMatch = !categoryFilterValue || p.category === categoryFilterValue;
            return nameMatch && categoryMatch;
        });

        filtered.sort((a, b) => {
            let A = sortBy === 'price' ? parseFloat(a.price || 0) : (a.description || '').toLowerCase();
            let B = sortBy === 'price' ? parseFloat(b.price || 0) : (b.description || '').toLowerCase();
            if (A < B) return sortDir === 'asc' ? -1 : 1;
            if (A > B) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        if (filtered.length === 0) {
            productListEl.innerHTML = "<p>No products found.</p>";
            skeletonLoader.style.display = 'none';
            return;
        }

        const productsByCategory = filtered.reduce((acc, product) => {
            const category = product.category || 'Uncategorized';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(product);
            return acc;
        }, {});

        const sortedCategories = Object.keys(productsByCategory).sort();

        sortedCategories.forEach(category => {
            const header = document.createElement('h2');
            header.className = 'category-header';
            header.textContent = category;
            productListEl.appendChild(header);

            const categoryGrid = document.createElement('div');
            categoryGrid.className = 'category-product-grid';

            productsByCategory[category].forEach(p => {
                const card = document.createElement("div");
                card.className = "product-card";
                card.draggable = true;
    
                const stockVal = p.stock || 0;
                const status = p.status || 'Active';
                let stockClass = "out-of-stock";
                if (stockVal > 5) stockClass = "in-stock";
                else if (stockVal > 0) stockClass = "low";
                
                let isAddable = true;
                let overlayText = '';
    
                if (status === 'Discontinued') {
                    card.classList.add('is-discontinued');
                    card.draggable = false;
                    overlayText = 'DISCONTINUED';
                    isAddable = false;
                } else if (stockVal === 0 && status !== 'Inquiry Only') {
                    card.classList.add('is-out-of-stock');
                    card.draggable = false;
                    overlayText = 'OUT OF STOCK';
                    isAddable = false;
                } else if (status === 'Inquiry Only') {
                    card.classList.add('is-inquiry-only');
                    overlayText = 'INQUIRY ONLY';
                }
    
                card.innerHTML = `
                <img src="${p.imageUrl || 'placeholder.png'}" alt="${p.description}" onerror="this.onerror=null;this.src='placeholder.png'">
                <div class="product-details">
                    <div class="product-model">${p.model}</div>
                    <div class="product-name" title="${p.description}">${p.description}</div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="product-price">$${parseFloat(p.price || 0).toFixed(2)}</div>
                        <div class="product-stock ${stockClass}" data-model="${p.model}">
                            Stock: ${stockVal}
                        </div>
                    </div>
                </div>
                <button class="product-image-btn" title="Change Product Image"><i class="fas fa-camera"></i></button>
                ${overlayText ? `<div class="product-overlay">${overlayText}</div>` : ''}
                `;
                
                card.addEventListener("click", (e) => {
                    if (e.target.closest('.product-image-btn')) return;
                    if (!isAddable) {
                        showToast(`This product is ${overlayText.toLowerCase()} and cannot be added.`, 'error');
                        return;
                    }
                    if (status === 'Inquiry Only') {
                        if (confirm("This product's availability is unknown. Add to quote anyway (subject to confirmation)?")) {
                            addToQuote(p);
                        }
                        return;
                    }
                    addToQuote(p);
                });
                
                card.addEventListener('dragstart', (e) => {
                    if (!isAddable) {
                        e.preventDefault();
                        return;
                    }
                    e.dataTransfer.setData('application/json', JSON.stringify(p));
                });
    
                const imageBtn = card.querySelector('.product-image-btn');
                imageBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentProductForImageUpload = p;
                    showModal(imageUploadModal);
                });
    
                const stockEl = card.querySelector('.product-stock');
                stockEl.addEventListener('dblclick', async (ev) => {
                    ev.stopPropagation();
                    const newStockStr = prompt(`Set stock for ${p.model}:`, String(p.stock || 0));
                    if (newStockStr === null) return;
                    const newStock = parseInt(newStockStr, 10);
                    if (Number.isNaN(newStock)) return showToast('Invalid number', 'error');
                    try {
                        await apiRequest('/api/update-stock', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ model: p.model, stock: newStock })
                        });
                        await loadProducts();
                        showToast('Stock updated');
                    } catch (err) { /* Error handling in apiRequest */ }
                });

                categoryGrid.appendChild(card);
            });

            productListEl.appendChild(categoryGrid);
        });

        skeletonLoader.style.display = 'none';
    };

    const populateCategoryFilter = () => {
        if (!filterCategory) return;
        const categories = [...new Set(allProductsFlat.map(p => p.category))];
        filterCategory.innerHTML = '<option value="">All Categories</option>';
        categories.sort().forEach(c => {
            const option = document.createElement('option');
            option.value = c;
            option.textContent = c;
            filterCategory.appendChild(option);
        });
    };

    const populatePackagesDropdown = () => {
        if (!packagesDropdown) return;
        packagesDropdown.innerHTML = '';
        Object.keys(packages).forEach(pkgName => {
            const option = document.createElement('option');
            option.value = pkgName;
            option.textContent = pkgName;
            packagesDropdown.appendChild(option);
        });
    };

    // ----------------------
    // QUOTE MANAGEMENT
    // ----------------------
    const addToQuote = (productData) => {
        const uniqueId = productData.model || productData.description;
        const existing = quoteItems.find(it => it.uniqueId === uniqueId);
        if (existing) {
            existing.quantity++;
        } else {
            quoteItems.push({
                uniqueId: uniqueId, model: productData.model, description: productData.description,
                price: parseFloat(productData.price || 0), quantity: 1, category: productData.category
            });
        }
        renderQuote();
    };

    const renderQuote = () => {
        if (!tableBody) return;
        tableBody.innerHTML = "";
        emptyQuoteEl.style.display = quoteItems.length === 0 ? "block" : "none";

        quoteItems.forEach((item, index) => {
            const tr = document.createElement("tr");
            tr.className = 'quote-item';
            tr.innerHTML = `
            <td data-label="Product">${item.description}</td>
            <td data-label="Unit Price">$${item.price.toFixed(2)}</td>
            <td data-label="Qty"><input type="number" class="qty-input" value="${item.quantity}" min="1" data-index="${index}"></td>
            <td data-label="Total">$${(item.quantity * item.price).toFixed(2)}</td>
            <td data-label="Actions"><button class="btn-secondary" data-index="${index}">X</button></td>
        `;
            tableBody.appendChild(tr);
        });
        updateTotals();
    };

    const updateTotals = async () => {
        try {
            const installation = parseFloat(installationInput.value) || 0;
            const discountPercent = parseFloat(discountInput.value) || 0;

            const response = await apiRequest("/api/calculate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: quoteItems, installationCost: installation, discountPercent: discountPercent })
            });

            subtotalVal.textContent = `$${response.subtotal.toFixed(2)}`;
            vatVal.textContent = `$${response.vat.toFixed(2)}`;
            totalVal.textContent = `$${response.total.toFixed(2)}`;
        } catch (e) { /* Error handled by apiRequest */ }
    };

    const clearQuote = () => {
        quoteItems = [];
        customerNameInput.value = '';
        projectNameInput.value = '';
        installationInput.value = '0';
        discountInput.value = '0';
        currentQuoteId = null;
        renderQuote();
    };

    const getFullQuoteState = () => ({
        id: currentQuoteId, customerName: customerNameInput.value, projectName: projectNameInput.value,
        installationCost: parseFloat(installationInput.value) || 0,
        discountPercent: parseFloat(discountInput.value) || 0,
        items: quoteItems,
    });

    const loadFullQuoteState = (data) => {
        currentQuoteId = data.id || null;
        customerNameInput.value = data.customerName || '';
        projectNameInput.value = data.projectName || '';
        installationInput.value = data.installationCost || '0';
        discountInput.value = data.discountPercent || '0';
        quoteItems = data.items || [];
        renderQuote();
    };

    // --------------------------
    // ADMIN PANEL LOGIC
    // --------------------------
    const renderAdminProducts = () => {
        if (!adminProductTableBody) return;
        adminProductTableBody.innerHTML = "";
        const sortedProducts = [...allProductsFlat].sort((a,b) => (a.model || "").localeCompare(b.model || ""));

        if (sortedProducts.length === 0) {
            adminProductTableBody.innerHTML = '<tr><td colspan="6">No products in the catalog.</td></tr>';
            return;
        }

        sortedProducts.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Image"><img src="${p.imageUrl || 'placeholder.png'}" alt="${p.description}" onerror="this.onerror=null;this.src='placeholder.png'"></td>
                <td data-label="Model">${p.model}</td>
                <td data-label="Description">${p.description}</td>
                <td data-label="Price">$${parseFloat(p.price || 0).toFixed(2)}</td>
                <td data-label="Stock">${p.stock}</td>
                <td data-label="Actions" class="admin-actions">
                    <button class="btn-secondary admin-edit-btn" data-model="${p.model}">Edit</button>
                    <button class="btn-secondary admin-delete-btn" data-model="${p.model}">Del</button>
                </td>
            `;
            adminProductTableBody.appendChild(tr);
        });
    };

    const clearAdminForm = () => {
        if (!adminProductForm) return;
        adminProductForm.reset();
        adminFormMode.value = 'add';
        adminModelInput.readOnly = false;
        adminProductForm.querySelector('button[type="submit"]').textContent = 'Save Product';
    }

    // ----------------------
    // EVENT LISTENERS
    // ----------------------
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login.html';
        });
    }

    if (toggleUserQuotesBtn) {
        toggleUserQuotesBtn.addEventListener('click', () => {
            if (userQuotesWidget) userQuotesWidget.classList.toggle('is-collapsed');
        });
    }

    if (userQuotesTableBody) {
        userQuotesTableBody.addEventListener('click', async (e) => {
            const loadButton = e.target.closest('.load-user-quote-btn');
            const downloadButton = e.target.closest('.download-user-quote-btn');
            const contractButton = e.target.closest('.generate-user-contract-btn');

            if (loadButton) {
                const quoteId = loadButton.dataset.quoteId;
                try {
                    const quoteData = await apiRequest(`/api/load-quote/${quoteId}`);
                    loadFullQuoteState(quoteData);
                    showToast(`Quote "${quoteData.projectName || 'Untitled'}" loaded.`);
                    quotePanel.scrollIntoView({ behavior: 'smooth' });
                } catch (err) { /* Error handled by apiRequest */ }
            } else if (downloadButton) {
                const quoteId = downloadButton.dataset.quoteId;
                const projectName = downloadButton.dataset.projectName;
                try {
                    const response = await apiRequest(`/api/user/quote-pdf/${quoteId}`);
                    const blob = await response.blob();
                    downloadBlob(blob, `Quotation_${projectName}_${quoteId}.pdf`);
                } catch (error) {
                    console.error('PDF Download failed:', error);
                    showToast('Could not download PDF.', 'error');
                }
            } else if (contractButton) {
                const quoteId = contractButton.dataset.quoteId;
                const projectName = contractButton.dataset.projectName;
                try {
                    const response = await apiRequest(`/api/user/generate-contract/${quoteId}`);
                    const blob = await response.blob();
                    downloadBlob(blob, `Contract_${projectName}_${quoteId}.pdf`);
                } catch (error) {
                    console.error('Contract Download failed:', error);
                    showToast(`Could not download Contract: ${error.message}`, 'error');
                }
            }
        });
    }
    
    if (toggleCatalogBtn) {
        toggleCatalogBtn.addEventListener('click', () => {
            const mainContent = document.querySelector('.main-content');
            mainContent.classList.toggle('catalog-closed');
            const isClosed = mainContent.classList.contains('catalog-closed');
            const btnText = toggleCatalogBtn.querySelector('span');
            const btnIcon = toggleCatalogBtn.querySelector('i');
            if (isClosed) {
                btnText.textContent = 'Show Catalog';
                btnIcon.classList.remove('fa-eye-slash');
                btnIcon.classList.add('fa-eye');
            } else {
                btnText.textContent = 'Hide Catalog';
                btnIcon.classList.remove('fa-eye');
                btnIcon.classList.add('fa-eye-slash');
            }
        });
    }

    if (quotePanel) quotePanel.addEventListener('dragover', (e) => {
        e.preventDefault();
        quotePanel.classList.add('drag-over');
    });

    if (quotePanel) quotePanel.addEventListener('dragleave', () => quotePanel.classList.remove('drag-over'));

    if (quotePanel) quotePanel.addEventListener('drop', (e) => {
        e.preventDefault();
        quotePanel.classList.remove('drag-over');
        try {
            const productData = JSON.parse(e.dataTransfer.getData('application/json'));
            addToQuote(productData);
        } catch (err) {
            console.error("Failed to parse dropped data", err);
        }
    });

    if (darkModeToggle) darkModeToggle.addEventListener("click", () => {
        const isDarkMode = document.body.classList.toggle("dark-mode");
        localStorage.setItem("sq_theme", isDarkMode ? "dark" : "light");
        darkModeToggle.textContent = isDarkMode ? '☀️' : '🌙';
    });

    function showModal(modal) { if (modal) modal.classList.add("visible"); }
    function hideModal(modal) { if (modal) modal.classList.remove("visible"); }

    if (importPricesBtn) importPricesBtn.addEventListener('click', () => pricesFileInput.click());
    if (pricesFileInput) pricesFileInput.addEventListener('change', (e) => { handlePriceImport(e.target.files[0]); e.target.value = null; });
    if (clearCatalogBtn) clearCatalogBtn.addEventListener('click', async () => {
        if (confirm("Are you sure you want to delete the entire product catalog? This cannot be undone.")) {
            try {
                await apiRequest('/api/clear-catalog', { method: 'POST' });
                showToast("Product catalog cleared.", "success");
                await loadProducts();
            } catch (e) { /* Error handled by apiRequest */ }
        }
    });

    if (bulkLinkImagesBtn) {
        bulkLinkImagesBtn.addEventListener('click', async () => {
            if (!confirm("This will scan the uploads folder and link images to products where the filename matches a model number. Continue?")) {
                return;
            }
            showToast("Scanning and linking images...", "success");
            try {
                const result = await apiRequest("/api/admin/bulk-link-images", { method: "POST" });
                showToast(result.message, result.ok ? "success" : "error");
                await loadProducts();
            } catch (e) { /* Error handled by apiRequest */ }
        });
    }

    if (adminPanelBtn) adminPanelBtn.addEventListener('click', () => {
        renderAdminProducts();
        showModal(adminModal);
    });

    if (adminModalCancelBtn) adminModalCancelBtn.addEventListener('click', () => hideModal(adminModal));
    if (adminFormClearBtn) adminFormClearBtn.addEventListener('click', clearAdminForm);

    if (sendEmailBtn) sendEmailBtn.addEventListener('click', () => showModal(emailModal));
    if (document.getElementById('email-modal-cancel')) document.getElementById('email-modal-cancel').addEventListener('click', () => hideModal(emailModal));

    if (loadQuoteBtn) loadQuoteBtn.addEventListener('click', () => { showModal(loadModal); loadSavedQuotes(); });
    if(document.getElementById('load-modal-cancel')) document.getElementById('load-modal-cancel').addEventListener('click', () => hideModal(loadModal));
    
    if (selectImageBtn) selectImageBtn.addEventListener('click', () => imageFileInput.click());
    
    if (imageFileInput) imageFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                if (event.target && typeof event.target.result === 'string') {
                    imagePreview.src = event.target.result;
                    imagePreview.style.display = 'block';
                }
            };
            reader.readAsDataURL(file);
        }
    });

    if(document.getElementById('image-modal-cancel')) document.getElementById('image-modal-cancel').addEventListener('click', () => {
        hideModal(imageUploadModal);
        imageFileInput.value = '';
        imagePreview.src = '';
        imagePreview.style.display = 'none';
        currentProductForImageUpload = null;
    });

    if(document.getElementById('image-upload-confirm')) document.getElementById('image-upload-confirm').addEventListener('click', async () => {
        if (!currentProductForImageUpload || !imageFileInput.files[0]) {
            return showToast('Please select an image first', 'error');
        }

        const formData = new FormData();
        formData.append('image', imageFileInput.files[0]);

        try {
            await apiRequest(`/api/upload-image/${currentProductForImageUpload.model}`, { method: 'POST', body: formData });
            showToast('Image uploaded successfully!');
            hideModal(imageUploadModal);
            imageFileInput.value = '';
            imagePreview.src = '';
            imagePreview.style.display = 'none';
            await loadProducts();
            if (adminModal.classList.contains('visible')) {
                renderAdminProducts();
            }
        } catch (e) { /* Error handled by apiRequest */ }
    });

    if (saveQuoteBtn) saveQuoteBtn.addEventListener('click', async () => {
        if (quoteItems.length === 0) return showToast("Cannot save an empty quote.", "error");

        const quoteData = getFullQuoteState();
        try {
            const data = await apiRequest("/api/save-quote", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quoteData),
            });
            currentQuoteId = data.id;
            showToast(`Quote "${quoteData.projectName || 'Untitled'}" saved successfully!`);
            await loadAndRenderUserQuotes();
        } catch (e) { /* Error handled by apiRequest */ }
    });

    const loadSavedQuotes = async () => {
        try {
            const quotes = await apiRequest("/api/load-quotes");
            savedQuotesList.innerHTML = '';

            if (quotes.length === 0) {
                savedQuotesList.innerHTML = '<li>No saved quotes found.</li>';
                return;
            }

            quotes.forEach(q => {
                const li = document.createElement('li');
                li.innerHTML = `
                <strong>${q.project_name || 'Untitled Project'}</strong><br>
                <small>Customer: ${q.customer_name || 'N/A'} | Saved: ${new Date(q.timestamp).toLocaleString()}</small>`;
                li.addEventListener('click', async () => {
                    try {
                        const quoteData = await apiRequest(`/api/load-quote/${q.id}`);
                        loadFullQuoteState(quoteData);
                        showToast(`Quote "${q.project_name || 'Untitled'}" loaded.`);
                        hideModal(loadModal);
                    } catch (e) { /* Error handled by apiRequest */ }
                });
                savedQuotesList.appendChild(li);
            });
        } catch (e) {
            savedQuotesList.innerHTML = '<li>Error loading quotes</li>';
        }
    };

    if (exportPdfBtn) exportPdfBtn.addEventListener('click', async () => {
        if(quoteItems.length === 0) return showToast("Cannot export an empty quote.", "error");
        
        showToast("Generating PDF...", "success");
        try {
            const quoteData = getFullQuoteState();
            
            const saveData = await apiRequest("/api/save-quote", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quoteData),
            });
            currentQuoteId = saveData.id;
            await loadAndRenderUserQuotes();

            const response = await apiRequest("/api/export-pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    quoteData: quoteItems,
                    customerInfo: { name: customerNameInput.value, project: projectNameInput.value },
                    installationCost: parseFloat(installationInput.value) || 0,
                    discountPercent: parseFloat(discountInput.value) || 0
                })
            });
            
            const blob = await response.blob();
            downloadBlob(blob, `Quotation_${projectNameInput.value || 'project'}.pdf`);
            
            showToast("PDF exported successfully!");
        } catch (e) {
            showToast(`Error exporting PDF: ${e.message}`, 'error');
        }
    });

    if(document.getElementById('generate-ai-btn')) document.getElementById('generate-ai-btn').addEventListener('click', async () => {
        try {
            const quoteData = getFullQuoteState();
            const response = await apiRequest("/api/generate-email", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customerName: quoteData.customerName, projectName: quoteData.projectName,
                    totals: {
                        total: parseFloat(totalVal.textContent.replace('$', '')),
                        subtotal: parseFloat(subtotalVal.textContent.replace('$', ''))
                    },
                    tone: document.getElementById('email-tone').value
                })
            });
            document.getElementById('email-body').value = response.emailBody;
        } catch (e) { /* Error handled by apiRequest */ }
    });

    if(document.getElementById('email-send-confirm')) document.getElementById('email-send-confirm').addEventListener('click', async () => {
        const recipient = document.getElementById('email-recipient').value;
        if (!recipient) return showToast('Please enter a recipient email', 'error');

        try {
            const quoteData = getFullQuoteState();
            await apiRequest("/api/send-email", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipientEmail: recipient, emailBody: document.getElementById('email-body').value,
                    quoteData: quoteData.items,
                    customerInfo: { name: quoteData.customerName, project: quoteData.projectName },
                    totals: {
                        subtotal: parseFloat(subtotalVal.textContent.replace('$', '')),
                        installation: quoteData.installationCost, discountPercent: quoteData.discountPercent,
                        vat: parseFloat(vatVal.textContent.replace('$', '')), total: parseFloat(totalVal.textContent.replace('$', ''))
                    }
                })
            });

            showToast("Email sent successfully!");
            hideModal(emailModal);
        } catch (e) { /* Error handled by apiRequest */ }
    });

    if (addPackageBtn) addPackageBtn.addEventListener('click', () => {
        const packageName = packagesDropdown.value;
        if(!packageName) return;
        const packageProducts = packages[packageName];
        
        for (const [productName, qty] of Object.entries(packageProducts)) {
            const product = allProductsFlat.find(p => p.description === productName);
            if (product) {
                for (let i = 0; i < qty; i++) { addToQuote(product); }
            } else {
                console.warn(`Product not found: ${productName}`);
            }
        }
    });

    if (tableBody) tableBody.addEventListener("change", (e) => {
        if (e.target.classList.contains("qty-input")) {
            const index = parseInt(e.target.dataset.index, 10);
            const newQty = parseInt(e.target.value, 10);
            if (newQty > 0) {
                quoteItems[index].quantity = newQty;
                renderQuote();
            } else {
                e.target.value = quoteItems[index].quantity;
            }
        }
    });

    if (tableBody) tableBody.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") {
            const index = e.target.dataset.index;
            quoteItems.splice(index, 1);
            renderQuote();
        }
    });

    if (adminProductTableBody) adminProductTableBody.addEventListener('click', (e) => {
        if (!(e.target instanceof HTMLElement)) return;
        const model = e.target.dataset.model;
        if (!model) return;

        if (e.target.classList.contains('admin-edit-btn')) {
            const productToEdit = allProductsFlat.find(p => p.model === model);
            if (productToEdit) {
                adminFormMode.value = 'edit';
                adminModelInput.value = productToEdit.model;
                adminModelInput.readOnly = true;
                document.getElementById('admin-description').value = productToEdit.description;
                document.getElementById('admin-category').value = productToEdit.category;
                document.getElementById('admin-price').value = String(productToEdit.price);
                document.getElementById('admin-stock').value = String(productToEdit.stock);
                document.getElementById('admin-status').value = productToEdit.status || 'Active';
                adminProductForm.querySelector('button[type="submit"]').textContent = 'Update Product';
                adminProductForm.scrollIntoView({ behavior: 'smooth' });
            }
        }

        if (e.target.classList.contains('admin-delete-btn')) {
            if (confirm(`Are you sure you want to delete product ${model}?`)) {
                apiRequest(`/api/admin/product/${model}`, { method: 'DELETE' })
                    .then(async (res) => {
                        showToast(res.message);
                        await loadProducts();
                        renderAdminProducts();
                    })
                    .catch(err => { /* Error handled by apiRequest */ });
            }
        }
    });
    
    if (adminProductForm) adminProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const productData = {
            model: adminModelInput.value.trim(),
            description: document.getElementById('admin-description').value.trim(),
            category: document.getElementById('admin-category').value.trim(),
            price: parseFloat(document.getElementById('admin-price').value),
            stock: parseInt(document.getElementById('admin-stock').value, 10),
            status: document.getElementById('admin-status').value
        };

        if (!productData.model || !productData.description || !productData.category) {
            return showToast('Model, Description, and Category are required.', 'error');
        }
        
        let url, method;
        if (adminFormMode.value === 'add') {
            url = '/api/admin/product';
            method = 'POST';
        } else {
            url = `/api/admin/product/${productData.model}`;
            method = 'PUT';
        }

        try {
            const res = await apiRequest(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productData)
            });
            showToast(res.message);
            clearAdminForm();
            await loadProducts();
            renderAdminProducts();
        } catch (err) { /* Error handled by apiRequest */ }
    });

    // ----------------------
    // INIT
    // ----------------------
    if (installationInput) installationInput.addEventListener("input", updateTotals);
    if (discountInput) discountInput.addEventListener("input", updateTotals);
    if (customerNameInput) customerNameInput.addEventListener("input", updateTotals);
    if (projectNameInput) projectNameInput.addEventListener("input", updateTotals);
    
    if (filterCategory) filterCategory.addEventListener("change", () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(renderProducts, 300);
    });
    if (sortSelect) sortSelect.addEventListener("change", () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(renderProducts, 300);
    });
    
    if (searchInput) searchInput.addEventListener('keyup', () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(renderProducts, 300);
    });

    if (clearQuoteBtn) clearQuoteBtn.addEventListener('click', clearQuote);
    
    const savedTheme = localStorage.getItem('sq_theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (darkModeToggle) darkModeToggle.textContent = '☀️';
    }
    
    (async function init() {
        if (userQuotesWidget) {
            userQuotesWidget.classList.add('is-collapsed');
        }

        await Promise.all([loadProducts(), loadPackages(), loadAndRenderUserQuotes()]);

        const urlParams = new URLSearchParams(window.location.search);
        let quoteIdToLoad = urlParams.get('quoteId');

        if (!quoteIdToLoad) {
            quoteIdToLoad = localStorage.getItem('quoteToLoad');
        }

        if (quoteIdToLoad) {
            try {
                const quoteData = await apiRequest(`/api/load-quote/${quoteIdToLoad}`);
                loadFullQuoteState(quoteData);
                showToast(`Loaded quote from dashboard.`);
            } catch (e) {
                showToast('Could not load the selected quote.', 'error');
            } finally {
                if (localStorage.getItem('quoteToLoad')) {
                    localStorage.removeItem('quoteToLoad');
                }
                if (urlParams.has('quoteId')) {
                    const newUrl = window.location.pathname;
                    window.history.replaceState({}, document.title, newUrl);
                }
            }
        }
    })();
});
