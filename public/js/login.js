document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const role = document.getElementById('userRole').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // ডোনার বা হসপিটাল লগিন API কল
    const endpoint = role === 'donor' ? '/api/donor/login' : '/api/hospital/login';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const result = await response.json();

        if (result.success) {
            // ব্রাউজারের মেমোরিতে ইউজারের ডেটা সেভ রাখা
            localStorage.setItem('userRole', role);
            if (role === 'donor')   localStorage.setItem('userData', JSON.stringify(result.donorData));
            if (role === 'hospital') localStorage.setItem('userData', JSON.stringify(result.hospitalData));

            await showPopup(result.message, 'success', { title: 'লগিন সফল' });

            // ইউজার অনুযায়ী সঠিক ড্যাশবোর্ডে রিডাইরেক্ট
            if (role === 'donor') {
                window.location.replace('/donor-dashboard.html');
            } else if (role === 'hospital') {
                window.location.replace('/hospital-dashboard.html');
            }

        } else {
            await showPopup(result.message, 'error', { title: 'লগিন ব্যর্থ' });
        }
    } catch (error) {
        await showPopup('সার্ভারে কানেক্ট করা যাচ্ছে না!', 'error');
    }
});