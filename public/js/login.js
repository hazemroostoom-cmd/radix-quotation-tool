document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const errorMessageEl = document.getElementById('error-message');

    // Redirect if user is already logged in
    fetch('/api/auth/status').then(res => {
        if (res.ok) {
            window.location.href = '/index.html';
        }
    });

    togglePasswordBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        togglePasswordBtn.textContent = isPassword ? '🙈' : '👁️';
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessageEl.style.display = 'none';
        errorMessageEl.textContent = '';

        const email = emailInput.value;
        const password = passwordInput.value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed. Please try again.');
            }

            if (data.ok && data.redirect) {
                window.location.href = data.redirect;
            } else {
                 throw new Error('Login failed. Please try again.');
            }

        } catch (error) {
            errorMessageEl.textContent = error.message;
            errorMessageEl.style.display = 'block';
        }
    });
});

