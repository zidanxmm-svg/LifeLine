document.getElementById('rootLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const rootUser = document.getElementById('rootUser').value;
    const masterKey = document.getElementById('masterKey').value;
    const submitBtn = e.target.querySelector('button');
    const originalText = submitBtn.innerText;

    submitBtn.innerText = 'VERIFYING...';
    submitBtn.disabled = true;

    try {
        const response = await fetch('/api/superadmin/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rootUser, masterKey })
        });
        const result = await response.json();

        if (result.success) {
            localStorage.setItem('userRole', 'superadmin');
            localStorage.setItem('masterKey', masterKey);
            await showPopup('Root access verified successfully.', 'success', { title: 'ACCESS GRANTED' });
            window.location.href = '/admin-panel';
        } else {
            await showPopup(result.message, 'error', { title: 'ACCESS DENIED' });
        }
    } catch (error) {
        await showPopup('সার্ভারে কানেক্ট করা যাচ্ছে না!', 'error');
    } finally {
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
});
