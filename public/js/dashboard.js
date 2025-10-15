// --- Authentication Check ---
// This runs first to ensure the user is logged in.
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
            // User is authenticated, allow the rest of the script to proceed.
            const userNameEl = document.querySelector('#user-name');
            if (userNameEl) {
                userNameEl.textContent = data.user.name;
            }
        }
    })
    .catch(error => {
        if (error !== 'Not authenticated') {
            console.error('Authentication check failed:', error);
            window.location.href = '/login.html';
        }
    });

// --- Main Dashboard Logic ---
// This waits for the HTML document to be fully loaded before running.
document.addEventListener("DOMContentLoaded", () => {
    // --- STATE ---
    let allInventoryProducts = []; // To hold the master list of all products

    // --- ELEMENTS ---
    const monthlyTotalValueEl = document.getElementById("monthly-total-value");
    const monthlyQuoteCountEl = document.getElementById("monthly-quote-count");
    const topProductsWidgetEl = document.querySelector("#top-products-widget .widget-list");
    const inventoryTableBodyEl = document.getElementById("inventory-table-body");
    const darkModeToggle = document.getElementById("toggle-dark-mode");
    const inventorySearchInput = document.getElementById("inventory-search");
    const inventorySortSelect = document.getElementById("inventory-sort");
    const inventoryWidget = document.getElementById("inventory-widget");
    const toggleInventoryBtn = document.getElementById("toggle-inventory-btn");
    const logoutBtn = document.getElementById('logout-btn');
    const userTableBodyEl = document.getElementById("user-table-body");
    const editUserModal = document.getElementById('edit-user-modal');
    const editUserForm = document.getElementById('edit-user-form');
    const editUserIdInput = document.getElementById('edit-user-id');
    const editUserNameInput = document.getElementById('edit-user-name');
    const editUserEmailInput = document.getElementById('edit-user-email');
    const editUserPasswordInput = document.getElementById('edit-user-password');
    const editUserRoleInput = document.getElementById('edit-user-role');
    const addUserForm = document.getElementById('add-user-form');
    const editUserCancelBtn = document.getElementById('edit-user-cancel-btn');
    const userManagementWidget = document.getElementById("user-management-widget");
    const toggleUsersBtn = document.getElementById("toggle-users-btn");
    const userCountBadgeEl = document.getElementById("user-count-badge");

    // New elements for all quotes widget
    const allQuotesWidget = document.getElementById("all-quotes-widget");
    const toggleAllQuotesBtn = document.getElementById("toggle-all-quotes-btn");
    const allQuotesTableBodyEl = document.getElementById("all-quotes-table-body");


    // --- MAIN DATA & RENDER LOGIC ---
    const updateAndRenderInventory = () => {
        if (!inventorySearchInput || !inventorySortSelect) return;

        const searchTerm = inventorySearchInput.value.toLowerCase();
        const sortOption = inventorySortSelect.value;

        let processedProducts = allInventoryProducts.filter(p => {
            const descriptionMatch = (p.description || '').toLowerCase().includes(searchTerm);
            const modelMatch = (p.model || '').toLowerCase().includes(searchTerm);
            return descriptionMatch || modelMatch;
        });

        processedProducts.sort((a, b) => {
            switch (sortOption) {
                case 'stock_asc':
                    return a.stock - b.stock;
                case 'stock_desc':
                    return b.stock - a.stock;
                case 'name_asc':
                    return (a.description || '').localeCompare(b.description || '');
                case 'name_desc':
                    return (b.description || '').localeCompare(a.description || '');
                default:
                    return 0;
            }
        });

        renderInventoryTable(processedProducts);
    };

    const loadDashboardData = async () => {
        try {
            const statsResponse = await fetch("/api/dashboard-stats");
            if (!statsResponse.ok) throw new Error(`HTTP error! Status: ${statsResponse.status}`);
            const stats = await statsResponse.json();
            
            allInventoryProducts = stats.all_products;

            renderMonthlyStats(stats.monthly_stats);
            renderTopProducts(stats.top_products);
            updateAndRenderInventory();

        } catch (error) {
            console.error("Failed to load dashboard stats:", error);
            if(topProductsWidgetEl) topProductsWidgetEl.innerHTML = '<li>Error loading data.</li>';
            if(inventoryTableBodyEl) inventoryTableBodyEl.innerHTML = '<tr><td colspan="3">Error loading data.</td></tr>';
        }

        loadAndRenderUsers();
        loadAndRenderAllQuotes();
    };

    // --- RENDER FUNCTIONS ---
    const renderMonthlyStats = (stats) => {
        if(monthlyTotalValueEl) monthlyTotalValueEl.textContent = `$${stats.total_value.toFixed(2)}`;
        if(monthlyQuoteCountEl) monthlyQuoteCountEl.textContent = stats.quote_count;
    };

    const renderTopProducts = (products) => {
        if (!topProductsWidgetEl) return;
        if (products.length === 0) {
            topProductsWidgetEl.innerHTML = '<li>No products quoted yet.</li>';
            return;
        }
        const maxCount = Math.max(...products.map(p => p.count), 1);
        topProductsWidgetEl.innerHTML = products.map(p => {
            const barWidth = (p.count / maxCount) * 100;
            return `
                <li>
                    <div class="widget-item-info">
                        <span class="widget-item-title">${p.description} (${p.model})</span>
                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: ${barWidth}%;"></div>
                        </div>
                    </div>
                    <span class="widget-item-value">${p.count}</span>
                </li>
            `;
        }).join('');
    };
    
    const renderInventoryTable = (products) => {
        if (!inventoryTableBodyEl) return;
        if (products.length === 0) {
            inventoryTableBodyEl.innerHTML = '<tr><td colspan="3">No products match your search.</td></tr>';
            return;
        }
        const MAX_STOCK_VISUAL = 20; 
        inventoryTableBodyEl.innerHTML = products.map(p => {
            const stock = p.stock;
            let statusClass, statusText, barClass;
            if (stock === 0) {
                statusClass = 'out-of-stock'; statusText = 'Out of Stock'; barClass = 'out-of-stock';
            } else if (stock <= 5) {
                statusClass = 'low'; statusText = 'Low Stock'; barClass = 'low';
            } else {
                statusClass = 'in-stock'; statusText = 'In Stock'; barClass = 'in-stock';
            }
            const barPercentage = Math.min((stock / MAX_STOCK_VISUAL) * 100, 100);
            return `
                <tr data-model="${p.model}">
                    <td data-label="Product">
                        <div class="widget-item-title">${p.description}</div>
                        <div class="widget-item-model">${p.model}</div>
                    </td>
                    <td data-label="Stock Level">
                        <div class="stock-level-cell">
                            <span class="stock-value-display" title="Click to edit">${stock}</span>
                            <div class="stock-bar-container">
                                <div class="stock-bar ${barClass}" style="width: ${barPercentage}%;"></div>
                            </div>
                        </div>
                    </td>
                    <td data-label="Status"><span class="status-badge ${statusClass}">${statusText}</span></td>
                </tr>
            `;
        }).join('');
    };

    // --- USER MANAGEMENT RENDER & LOGIC ---
    const loadAndRenderUsers = async () => {
        if (!userTableBodyEl) return;
        try {
            const response = await fetch("/api/admin/users");
            if (!response.ok) throw new Error("Failed to fetch users.");
            const data = await response.json();
            
            if(userCountBadgeEl) {
                userCountBadgeEl.textContent = data.users.length;
            }
            renderUserTable(data.users, data.currentUserId);

        } catch (error) {
            console.error(error);
            userTableBodyEl.innerHTML = `<tr><td colspan="4">Error loading users.</td></tr>`;
        }
    };

    const renderUserTable = (users, currentUserId) => {
        if (!userTableBodyEl) return;
        if (users.length === 0) {
            userTableBodyEl.innerHTML = `<tr><td colspan="4">No users found.</td></tr>`;
            return;
        }
        userTableBodyEl.innerHTML = users.map(user => {
            const isCurrentUser = user.id === currentUserId;
            const isApproved = user.is_approved === 1;

            let statusHtml = isApproved
                ? `<span class="status-badge in-stock">Approved</span>`
                : `<span class="status-badge low">Pending</span>`;

            let actionsHtml = '';
            if (isApproved) {
                actionsHtml = `
                    <button class="btn-secondary edit-user-btn" title="Edit ${user.name}" data-user-id="${user.id}" data-user-name="${user.name}" data-user-email="${user.email}" data-user-role="${user.role}"><i class="fas fa-edit"></i></button>
                    <button class="btn-secondary delete-user-btn" title="Delete ${user.name}" data-user-id="${user.id}" data-user-name="${user.name}" ${isCurrentUser ? 'disabled' : ''}><i class="fas fa-trash-alt"></i></button>
                `;
            } else {
                actionsHtml = `
                    <button class="btn-primary approve-user-btn" title="Approve ${user.name}" data-user-id="${user.id}" data-user-name="${user.name}"><i class="fas fa-check"></i> Approve</button>
                    <button class="btn-secondary delete-user-btn" title="Delete ${user.name}" data-user-id="${user.id}" data-user-name="${user.name}"><i class="fas fa-trash-alt"></i></button>
                `;
            }

            return `
            <tr class="${isCurrentUser ? 'current-user-row' : ''}" data-user-id="${user.id}">
                <td data-label="Name">
                    ${user.name} 
                    <span class="status-badge self-badge">${user.role}</span>
                    ${isCurrentUser ? '<span class="status-badge self-badge">You</span>' : ''}
                </td>
                <td data-label="Email">${user.email}</td>
                <td data-label="Status">${statusHtml}</td>
                <td data-label="Actions" class="admin-actions">${actionsHtml}</td>
            </tr>
            `}).join('');
    };

    // --- ALL QUOTES RENDER & LOGIC ---
    const loadAndRenderAllQuotes = async () => {
        if (!allQuotesTableBodyEl) return;
        try {
            const response = await fetch("/api/admin/all-quotes");
            if (!response.ok) throw new Error("Failed to fetch quotes.");
            const quotes = await response.json();
            renderAllQuotesTable(quotes);
        } catch (error) {
            console.error(error);
            allQuotesTableBodyEl.innerHTML = `<tr><td colspan="6">Error loading quotes.</td></tr>`;
        }
    };

    const renderAllQuotesTable = (quotes) => {
        if (!allQuotesTableBodyEl) return;
        if (quotes.length === 0) {
            allQuotesTableBodyEl.innerHTML = `<tr><td colspan="6">No saved quotes found.</td></tr>`;
            return;
        }
        allQuotesTableBodyEl.innerHTML = quotes.map(quote => {
            const isConfirmed = quote.status === 'Confirmed';
            let actionButtons = '';
            if (isConfirmed) {
                actionButtons = `
                    <button class="btn-primary confirm-quote-btn" title="Stock has been deducted" disabled>
                        <i class="fas fa-check-circle"></i> Confirmed
                    </button>
                    <button class="btn-secondary generate-contract-btn" title="Generate Contract PDF" data-quote-id="${quote.id}" data-project-name="${quote.project_name || 'project'}">
                        <i class="fas fa-file-signature"></i> Contract
                    </button>
                `;
            } else {
                 actionButtons = `
                    <button class="btn-primary confirm-quote-btn" title="Confirm & Deduct Stock" data-quote-id="${quote.id}">
                        <i class="fas fa-check-circle"></i> Confirm
                    </button>
                    <button class="btn-secondary download-quote-pdf-btn" title="Download Quotation PDF" data-quote-id="${quote.id}" data-project-name="${quote.project_name || 'project'}">
                        <i class="fas fa-file-pdf"></i> Quote
                    </button>
                `;
            }

            return `
            <tr class="quote-row ${isConfirmed ? 'confirmed-quote' : ''}" data-quote-id="${quote.id}">
                <td data-label="Project" title="Click to load this quote in the tool">${quote.project_name || 'Untitled Project'}</td>
                <td data-label="Customer">${quote.customer_name || 'N/A'}</td>
                <td data-label="Created By">${quote.user_name || 'System/Legacy'}</td>
                <td data-label="Date">${new Date(quote.timestamp).toLocaleString()}</td>
                <td data-label="Status">
                    <span class="status-badge ${isConfirmed ? 'in-stock' : 'low'}">${quote.status || 'Draft'}</span>
                </td>
                <td data-label="Actions" class="admin-actions">
                   ${actionButtons}
                </td>
            </tr>
        `}).join('');
    };


    // --- EVENT LISTENERS ---
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login.html';
        });
    }

    if (inventorySearchInput) {
        inventorySearchInput.addEventListener('input', () => {
            setTimeout(updateAndRenderInventory, 200);
        });
    }

    if (inventorySortSelect) {
        inventorySortSelect.addEventListener('change', updateAndRenderInventory);
    }

    if (inventoryTableBodyEl) {
        inventoryTableBodyEl.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('stock-value-display')) {
                const currentSpan = e.target;
                const currentCell = currentSpan.parentElement;
                const currentStock = currentSpan.textContent;
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'stock-edit-input';
                input.value = currentStock;
                currentCell.innerHTML = '';
                currentCell.appendChild(input);
                input.focus();
                input.select();
                const saveStockUpdate = async () => {
                    const newStockStr = input.value.trim();
                    const model = input.closest('tr').dataset.model;
                    if (newStockStr === '' || newStockStr === currentStock) {
                        updateAndRenderInventory();
                        return;
                    }
                    const newStock = parseInt(newStockStr, 10);
                    try {
                        await fetch('/api/update-stock', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ model, stock: newStock })
                        });
                        const productInState = allInventoryProducts.find(p => p.model === model);
                        if (productInState) productInState.stock = newStock;
                    } catch (error) {
                        console.error("Failed to update stock:", error);
                    } finally {
                        updateAndRenderInventory();
                    }
                };
                input.addEventListener('blur', saveStockUpdate);
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') input.blur();
                    else if (event.key === 'Escape') { input.value = currentStock; input.blur(); }
                });
            }
        });
    }

    if (toggleInventoryBtn) {
        toggleInventoryBtn.addEventListener('click', () => {
            if (inventoryWidget) inventoryWidget.classList.toggle('is-collapsed');
        });
    }

    if (toggleUsersBtn) {
        toggleUsersBtn.addEventListener('click', () => {
            if (userManagementWidget) userManagementWidget.classList.toggle('is-collapsed');
        });
    }

    if (toggleAllQuotesBtn) {
        toggleAllQuotesBtn.addEventListener('click', () => {
            if (allQuotesWidget) allQuotesWidget.classList.toggle('is-collapsed');
        });
    }

    if (userTableBodyEl) {
        userTableBodyEl.addEventListener('click', async (e) => {
            const targetButton = e.target.closest('button');
            if (!targetButton) return;
            const target = targetButton;

            if (target.classList.contains('edit-user-btn')) {
                editUserIdInput.value = target.dataset.userId;
                editUserNameInput.value = target.dataset.userName;
                editUserEmailInput.value = target.dataset.userEmail;
                editUserRoleInput.value = target.dataset.userRole;
                editUserPasswordInput.value = '';
                editUserModal.classList.add('visible');
            }

            if (target.classList.contains('delete-user-btn')) {
                const userId = target.dataset.userId;
                const userName = target.dataset.userName;
                if (confirm(`Are you sure you want to delete user "${userName}"? This action cannot be undone.`)) {
                    try {
                        const response = await fetch(`/api/admin/user/${userId}`, { method: 'DELETE' });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || 'Failed to delete user.');
                        alert('User deleted successfully.');
                        loadAndRenderUsers();
                    } catch (error) {
                        alert(`Error: ${error.message}`);
                    }
                }
            }
            
            if (target.classList.contains('approve-user-btn')) {
                const userId = target.dataset.userId;
                const userName = target.dataset.userName;
                try {
                    const response = await fetch(`/api/admin/user/approve/${userId}`, { method: 'POST' });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'Failed to approve user.');
                    alert(`User "${userName}" has been approved.`);
                    loadAndRenderUsers();
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
        });
    }
    
    if (allQuotesWidget) {
        allQuotesWidget.addEventListener('click', async (e) => {
            const row = e.target.closest('tr.quote-row');
            const downloadBtn = e.target.closest('.download-quote-pdf-btn');
            const confirmBtn = e.target.closest('.confirm-quote-btn');
            const contractBtn = e.target.closest('.generate-contract-btn');
    
            if (confirmBtn && !confirmBtn.disabled) {
                e.stopPropagation();
                const quoteId = confirmBtn.dataset.quoteId;
                if (!confirm(`Are you sure you want to confirm this quote and deduct stock? This action cannot be undone.`)) {
                    return;
                }
                
                try {
                    const response = await fetch(`/api/admin/quote/confirm/${quoteId}`, { method: 'POST' });
                    const result = await response.json();

                    if (!response.ok) {
                        throw new Error(result.error || 'Failed to confirm quote.');
                    }
                    
                    alert(result.message);
                    loadDashboardData();
                    
                } catch (error) {
                    console.error('Confirmation failed:', error);
                    alert(`Could not confirm quote: ${error.message}`);
                }
            
            } else if (downloadBtn) {
                e.stopPropagation();
                const quoteId = downloadBtn.dataset.quoteId;
                const projectName = downloadBtn.dataset.projectName;
                
                try {
                    const response = await fetch(`/api/admin/quote-pdf/${quoteId}`);
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({error: 'PDF generation failed on server.'}));
                        throw new Error(errorData.error);
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Quotation_${projectName}_${quoteId}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                } catch (error) {
                    console.error('PDF Download failed:', error);
                    alert(`Could not download PDF: ${error.message}`);
                }
    
            } else if (contractBtn) {
                e.stopPropagation();
                const quoteId = contractBtn.dataset.quoteId;
                const projectName = contractBtn.dataset.projectName;
                 try {
                    const response = await fetch(`/api/admin/generate-contract/${quoteId}`);
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({error: 'Contract generation failed.'}));
                        throw new Error(errorData.error);
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Contract_${projectName}_${quoteId}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                } catch (error) {
                    console.error('Contract Download failed:', error);
                    alert(`Could not download Contract: ${error.message}`);
                }

            } else if (row) {
                const quoteId = row.dataset.quoteId;
                // Use localStorage to pass the quoteId to the index page
                localStorage.setItem('quoteToLoad', quoteId);
                window.open(`/index.html`, '_blank');
            }
        });
    }

    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userId = editUserIdInput.value;
            const payload = {
                name: editUserNameInput.value,
                email: editUserEmailInput.value,
                role: editUserRoleInput.value,
            };
            if (editUserPasswordInput.value) {
                payload.password = editUserPasswordInput.value;
            }

            try {
                const response = await fetch(`/api/admin/user/${userId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Update failed.');

                alert('User updated successfully.');
                editUserModal.classList.remove('visible');
                loadAndRenderUsers();
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        });
    }

    if (addUserForm) {
        addUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                name: document.getElementById('add-user-name').value,
                email: document.getElementById('add-user-email').value,
                password: document.getElementById('add-user-password').value,
                role: document.getElementById('add-user-role').value,
            };

            try {
                const response = await fetch('/api/admin/user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to create user.');
                
                alert(result.message);
                addUserForm.reset();
                loadAndRenderUsers();
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        });
    }

    if (editUserCancelBtn) {
        editUserCancelBtn.addEventListener('click', () => {
            editUserModal.classList.remove('visible');
        });
    }

    if (darkModeToggle) {
        darkModeToggle.addEventListener("click", () => {
            const isDarkMode = document.body.classList.toggle("dark-mode");
            localStorage.setItem("sq_theme", isDarkMode ? "dark" : "light");
            darkModeToggle.textContent = isDarkMode ? '☀️' : '🌙';
        });
    }

    const applySavedTheme = () => {
        const savedTheme = localStorage.getItem('sq_theme') || 'light';
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            if(darkModeToggle) darkModeToggle.textContent = '☀️';
        }
    };
    
    const initializeDefaultCollapsedState = () => {
        if (inventoryWidget) inventoryWidget.classList.add('is-collapsed');
        if (userManagementWidget) userManagementWidget.classList.add('is-collapsed');
        if(allQuotesWidget) allQuotesWidget.classList.add('is-collapsed');
        // Keep the quotes widget open by default
        // if (allQuotesWidget) allQuotesWidget.classList.add('is-collapsed');
    };

    // --- INITIALIZATION ---
    applySavedTheme();
    initializeDefaultCollapsedState();
    loadDashboardData();
});

