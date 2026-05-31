document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/api/unified-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const result = await response.json();

        if (result.success) {
            const role = result.role;
            localStorage.setItem('userRole', role);
            // Store a one-time toast message for the dashboard
            localStorage.setItem('loginToast', result.message || 'লগিন সফল হয়েছে!');

            if (role === 'hospital') {
                localStorage.setItem('userData', JSON.stringify(result.hospitalData));
                window.location.replace('/hospital-panel');
            } else if (role === 'doctor') {
                localStorage.setItem('userData', JSON.stringify(result.doctorData));
                window.location.replace('/dr-panel');
            } else if (role === 'donor') {
                localStorage.setItem('userData', JSON.stringify(result.donorData));
                window.location.replace('/donor-panel');
            }

        } else {
            showToast(result.message || 'ইউজারনেম বা পাসওয়ার্ড ভুল!', 'error', 4000);
        }
    } catch (error) {
        console.error('Login script error:', error);
        showToast('সার্ভারে কানেক্ট করা যাচ্ছে না!', 'error', 4000);
    }
});