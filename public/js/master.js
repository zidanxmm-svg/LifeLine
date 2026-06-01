const masterKey = localStorage.getItem('masterKey');
if (localStorage.getItem('userRole') !== 'superadmin' || !masterKey) {
    window.location.href = '/';
    throw new Error('Unauthorized master dashboard access');
}

let currentApplicationStatus = 'Pending';
let currentApplications = [];
let currentUserType = 'donors';
let currentUsers = [];
let editingUser = null;
let adminMap = null;
let adminMarker = null;
let mapTargetContext = null;
let selectedMapLocation = {
    latitude: 23.8103,
    longitude: 90.4125,
    address: 'Dhaka, Bangladesh'
};

function logout() {
    localStorage.clear();
    window.location.href = '/';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function numberText(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function valueOf(id) {
    return document.getElementById(id)?.value ?? '';
}

function setFieldValue(selector, value) {
    const field = document.querySelector(selector);
    if (field) field.value = value ?? '';
}

function setLastUpdated() {
    document.getElementById('lastUpdated').innerText = `Synced ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDate(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

function dateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toISOString().slice(0, 10);
}

function switchPanel(panelId) {
    document.querySelectorAll('.adminPanel').forEach((panel) => panel.classList.add('hidden'));
    document.getElementById(panelId).classList.remove('hidden');

    document.querySelectorAll('.navTab').forEach((tab) => {
        const active = tab.dataset.panel === panelId;
        tab.classList.toggle('bg-white/10', active);
        tab.classList.toggle('text-white', active);
        tab.classList.toggle('text-slate-300', !active);
    });

    if (panelId === 'applicationsPanel') loadApplications(currentApplicationStatus);
    if (panelId === 'usersPanel') loadUsers(currentUserType);
}

function getMapTarget(context) {
    const targets = {
        createHospital: {
            title: 'Select Hospital Location',
            location: '#hLocation',
            address: '#hAddress',
            latitude: '#hLatitude',
            longitude: '#hLongitude'
        },
        createDonor: {
            title: 'Select Donor Location',
            location: '#dLocation',
            address: '#dAddress',
            latitude: '#dLatitude',
            longitude: '#dLongitude'
        },
        editUser: {
            title: 'Select User Location',
            location: '#editUserForm [name="location"]',
            address: '#editUserForm [name="address"]',
            latitude: '#editUserForm [name="latitude"]',
            longitude: '#editUserForm [name="longitude"]'
        }
    };
    return targets[context];
}

function updateMapSelectedText() {
    const textEl = document.getElementById('adminMapSelectedText');
    if (textEl) {
        textEl.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>
            <span>Selected: <strong>${escapeHtml(selectedMapLocation.address)}</strong> (${selectedMapLocation.latitude.toFixed(5)}, ${selectedMapLocation.longitude.toFixed(5)})</span>
        `;
    }
}

function setSelectedMapLocation({ latitude, longitude, address }) {
    selectedMapLocation = {
        latitude: Number(latitude),
        longitude: Number(longitude),
        address: address || `${latitude}, ${longitude}`
    };
    updateMapSelectedText();
}

function initAdminMap() {
    if (typeof mapboxgl === 'undefined') {
        document.getElementById('adminMapSelectedText').innerText = 'Mapbox did not load. You can still type location manually.';
        return;
    }

    if (adminMap) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    adminMap = new mapboxgl.Map({
        container: 'adminMap',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [selectedMapLocation.longitude, selectedMapLocation.latitude],
        zoom: 11,
        maxBounds: [[85, 19], [94, 28]]
    });

    adminMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
    adminMap.addControl(new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false
    }), 'top-right');

    // Draggable marker
    const markerEl = document.createElement('div');
    markerEl.style.cssText = 'width:22px;height:22px;background:#0f172a;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:grab;';
    adminMarker = new mapboxgl.Marker({ element: markerEl, anchor: 'bottom', draggable: true })
        .setLngLat([selectedMapLocation.longitude, selectedMapLocation.latitude])
        .addTo(adminMap);

    adminMarker.on('dragend', () => {
        const lngLat = adminMarker.getLngLat();
        if (typeof mapboxReverseGeocode === 'function') {
            mapboxReverseGeocode(lngLat.lat, lngLat.lng).then(geo => {
                setSelectedMapLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address: geo.displayName || 'Dragged' });
            });
        } else {
            setSelectedMapLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address: 'Dragged map selection' });
        }
    });

    adminMap.on('click', async e => {
        const lngLat = e.lngLat;
        adminMarker.setLngLat([lngLat.lng, lngLat.lat]);
        if (typeof mapboxReverseGeocode === 'function') {
            const geo = await mapboxReverseGeocode(lngLat.lat, lngLat.lng);
            setSelectedMapLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address: geo.displayName || 'Map selection' });
        } else {
            setSelectedMapLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address: 'Manual map selection' });
        }
    });
}

function moveAdminMarker(lngLat, address) {
    if (!adminMarker || !adminMap) return;
    const lat = typeof lngLat.lat === 'function' ? lngLat.lat() : lngLat.lat;
    const lng = typeof lngLat.lng === 'function' ? lngLat.lng() : lngLat.lng;
    adminMarker.setLngLat([lng, lat]);
    adminMap.flyTo({ center: [lng, lat], zoom: 14 });
    setSelectedMapLocation({ latitude: lat, longitude: lng, address });
}

function openMapPicker(context) {
    const target = getMapTarget(context);
    if (!target) return;

    mapTargetContext = context;
    document.getElementById('adminMapTitle').innerText = target.title;

    const latitude = Number(document.querySelector(target.latitude)?.value);
    const longitude = Number(document.querySelector(target.longitude)?.value);
    const address = document.querySelector(target.address)?.value || document.querySelector(target.location)?.value || 'Dhaka, Bangladesh';

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        setSelectedMapLocation({ latitude, longitude, address });
    }

    document.getElementById('adminMapModal').classList.remove('hidden');
    document.getElementById('adminMapModal').classList.add('flex');
    initAdminMap();

    setTimeout(() => {
        if (!adminMarker || !adminMap) return;
        moveAdminMarker({ lat: selectedMapLocation.latitude, lng: selectedMapLocation.longitude }, selectedMapLocation.address);
    }, 100);
}

function closeMapPicker() {
    document.getElementById('adminMapModal').classList.add('hidden');
    document.getElementById('adminMapModal').classList.remove('flex');
    mapTargetContext = null;
}

function applyMapLocationToTarget() {
    const target = getMapTarget(mapTargetContext);
    if (!target) return;

    const shortLocation = selectedMapLocation.address.split(',')[0].trim();
    setFieldValue(target.location, shortLocation || selectedMapLocation.address);
    setFieldValue(target.address, selectedMapLocation.address);
    setFieldValue(target.latitude, selectedMapLocation.latitude.toFixed(7));
    setFieldValue(target.longitude, selectedMapLocation.longitude.toFixed(7));
    closeMapPicker();
}

document.querySelectorAll('.navTab').forEach((tab) => {
    tab.addEventListener('click', () => {
        switchPanel(tab.dataset.panel);
        const sidebar = document.getElementById('adminSidebar');
        if (sidebar && window.innerWidth < 1024) {
            sidebar.classList.add('-translate-x-full');
            sidebar.classList.remove('translate-x-0');
        }
    });
});

document.addEventListener('click', (event) => {
    const mapButton = event.target.closest('.openMapPicker');
    if (mapButton) openMapPicker(mapButton.dataset.context);
});

document.getElementById('closeAdminMap').addEventListener('click', closeMapPicker);
document.getElementById('adminApplyMapLocation').addEventListener('click', applyMapLocationToTarget);
document.getElementById('adminUseCurrentLocation').addEventListener('click', () => {
    if (!navigator.geolocation) {
        showPopup('আপনার ব্রাউজারে location support নেই।', 'warning');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const latLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: latLng }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    moveAdminMarker(latLng, results[0].formatted_address);
                } else {
                    moveAdminMarker(latLng, 'Current device location');
                }
            });
        },
        () => showPopup('লোকেশন permission পাওয়া যায়নি। Map/search দিয়ে সিলেক্ট করুন।', 'warning'),
        { enableHighAccuracy: true, timeout: 10000 }
    );
});

async function loadStats() {
    try {
        const res = await fetch('/api/superadmin/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterKey })
        });
        const result = await res.json();
        if (!result.success) return;

        const stats = result.data;
        document.getElementById('statPending').innerText = numberText(stats.pendingApplications);
        document.getElementById('statDonors').innerText = numberText(stats.totalDonors);
        document.getElementById('statHospitals').innerText = numberText(stats.activeHospitals);
        document.getElementById('statBeds').innerText = numberText(Number(stats.totalIcuBeds || 0) + Number(stats.totalEmergencyBeds || 0));
        document.getElementById('statApproved').innerText = numberText(stats.approvedApplications);
        document.getElementById('statRejected').innerText = numberText(stats.rejectedApplications);
        document.getElementById('statAvailableDonors').innerText = numberText(stats.availableDonors);
        document.getElementById('statBedBreakdown').innerText = `${numberText(stats.totalIcuBeds)} / ${numberText(stats.totalEmergencyBeds)}`;
        setLastUpdated();
    } catch (err) {
        console.error('Stats load failed:', err);
    }
}

function matchesApplicationSearch(application, query) {
    if (!query) return true;
    return [
        application.name,
        application.email,
        application.phone,
        application.location,
        application.address,
        application.blood_group,
        application.profession,
        application.contact_person,
        application.license_number
    ].join(' ').toLowerCase().includes(query.toLowerCase());
}

function applicationDetails(application) {
    const common = `
        <div><span class="detail-label">Location</span><strong class="detail-value">${escapeHtml(application.location)}</strong></div>
        <div><span class="detail-label">Address</span><strong class="detail-value">${escapeHtml(application.address || 'N/A')}</strong></div>
        <div><span class="detail-label">Latitude</span><strong class="detail-value">${escapeHtml(application.latitude || 'N/A')}</strong></div>
        <div><span class="detail-label">Longitude</span><strong class="detail-value">${escapeHtml(application.longitude || 'N/A')}</strong></div>
    `;

    if (application.type === 'donor') {
        return `
            ${common}
            <div><span class="detail-label">Blood</span><strong class="detail-value">${escapeHtml(application.blood_group)}</strong></div>
            <div><span class="detail-label">Profession</span><strong class="detail-value">${escapeHtml(application.profession)}</strong></div>
            <div><span class="detail-label">Donated</span><strong class="detail-value">${escapeHtml(application.donation_count)} times</strong></div>
            <div><span class="detail-label">Age</span><strong class="detail-value">${escapeHtml(application.age || 'N/A')}</strong></div>
            <div class="sm:col-span-2"><span class="detail-label">Health Notes</span><strong class="detail-value">${escapeHtml(application.health_notes || 'N/A')}</strong></div>
        `;
    }

    return `
        ${common}
        <div><span class="detail-label">Contact Person</span><strong class="detail-value">${escapeHtml(application.contact_person)}</strong></div>
        <div><span class="detail-label">License</span><strong class="detail-value">${escapeHtml(application.license_number)}</strong></div>
        <div><span class="detail-label">ICU Beds</span><strong class="detail-value">${escapeHtml(application.icu_available)}</strong></div>
        <div><span class="detail-label">Emergency Beds</span><strong class="detail-value">${escapeHtml(application.emergency_bed_available)}</strong></div>
    `;
}

function renderApplications() {
    const list = document.getElementById('applicationList');
    const query = document.getElementById('applicationSearch').value.trim();
    const filtered = currentApplications.filter((application) => matchesApplicationSearch(application, query));

    if (filtered.length === 0) {
        list.innerHTML = `<div class="p-5 bg-slate-50 border border-slate-200 rounded-md text-slate-600">No ${escapeHtml(currentApplicationStatus.toLowerCase())} applications found.</div>`;
        return;
    }

    list.innerHTML = '';
    filtered.forEach((application) => {
        const canReview = application.status === 'Pending';
        const typeClass = application.type === 'donor' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700';
        const card = document.createElement('article');
        card.className = 'rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden';
        card.innerHTML = `
            <button class="applicationToggle w-full text-left p-4 hover:bg-slate-50" type="button">
                <div class="grid md:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 md:items-center">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h4 class="font-bold text-slate-950">${escapeHtml(application.name)}</h4>
                            <span class="px-2 py-1 rounded text-xs font-bold ${typeClass}">${escapeHtml(application.type)}</span>
                        </div>
                        <p class="text-xs text-slate-500 mt-1">Click to view details</p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400 font-bold uppercase">Username / Email</p>
                        <p class="text-sm font-semibold break-words">${escapeHtml(application.email)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400 font-bold uppercase">WhatsApp</p>
                        <p class="text-sm font-semibold">${escapeHtml(application.phone)}</p>
                    </div>
                    <span class="text-sm font-bold text-slate-500">Details</span>
                </div>
            </button>
            <div class="applicationDetails hidden border-t border-slate-200 p-4 bg-slate-50">
                <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">${applicationDetails(application)}</div>
                ${application.review_message ? `<div class="mt-4 p-3 rounded-md bg-white border border-slate-200 text-sm"><strong>Review Message:</strong> ${escapeHtml(application.review_message)}</div>` : ''}
                ${canReview ? `
                    <div class="mt-4 grid md:grid-cols-[1fr_auto] gap-3">
                        <textarea class="reviewMessage w-full p-3 border border-slate-300 rounded-md focus:outline-none focus:border-slate-900" rows="2" placeholder="Optional message"></textarea>
                        <div class="grid grid-cols-2 gap-2">
                            <button class="approveBtn bg-emerald-600 text-white font-bold py-2 px-4 rounded-md hover:bg-emerald-700" data-id="${application.id}" type="button">Approve</button>
                            <button class="rejectBtn bg-red-600 text-white font-bold py-2 px-4 rounded-md hover:bg-red-700" data-id="${application.id}" type="button">Reject</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
        list.appendChild(card);
    });
    styleDetailFields(list);
}

function styleDetailFields(root) {
    root.querySelectorAll('.detail-label').forEach((label) => {
        label.className = 'block text-xs uppercase tracking-wide text-slate-400 font-bold';
    });
    root.querySelectorAll('.detail-value').forEach((value) => {
        value.className = 'block text-slate-800 font-semibold mt-1 break-words';
    });
}

async function loadApplications(status = currentApplicationStatus) {
    currentApplicationStatus = status;
    const list = document.getElementById('applicationList');
    list.innerHTML = '<div class="p-5 bg-slate-50 border border-slate-200 rounded-md text-slate-500">Loading applications...</div>';

    document.querySelectorAll('.statusTab').forEach((tab) => {
        const active = tab.dataset.status === currentApplicationStatus;
        tab.classList.toggle('bg-slate-900', active);
        tab.classList.toggle('text-white', active);
        tab.classList.toggle('bg-white', !active);
        tab.classList.toggle('text-slate-700', !active);
    });

    try {
        const res = await fetch('/api/superadmin/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterKey, status: currentApplicationStatus })
        });
        const result = await res.json();
        if (!result.success) {
            list.innerHTML = `<div class="p-5 bg-red-50 border border-red-200 rounded-md text-red-700">${escapeHtml(result.message)}</div>`;
            return;
        }
        currentApplications = result.data;
        renderApplications();
        setLastUpdated();
    } catch (err) {
        list.innerHTML = '<div class="p-5 bg-red-50 border border-red-200 rounded-md text-red-700">Server error while loading applications.</div>';
    }
}

async function reviewApplication(applicationId, decision, reviewMessage, button) {
    const originalText = button.innerText;
    button.innerText = decision === 'approve' ? 'Approving...' : 'Rejecting...';
    button.disabled = true;

    try {
        const res = await fetch('/api/superadmin/review-application', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterKey, applicationId, decision, reviewMessage })
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');
        if (result.success) await refreshDashboard();
    } catch (err) {
        await showPopup('সার্ভার এরর!', 'error');
    } finally {
        button.innerText = originalText;
        button.disabled = false;
    }
}

document.getElementById('applicationList').addEventListener('click', (event) => {
    const approveBtn = event.target.closest('.approveBtn');
    const rejectBtn = event.target.closest('.rejectBtn');
    if (approveBtn || rejectBtn) {
        const details = event.target.closest('.applicationDetails');
        const reviewMessage = details.querySelector('.reviewMessage')?.value || '';
        if (approveBtn) reviewApplication(Number(approveBtn.dataset.id), 'approve', reviewMessage, approveBtn);
        if (rejectBtn) reviewApplication(Number(rejectBtn.dataset.id), 'reject', reviewMessage, rejectBtn);
        return;
    }

    const toggle = event.target.closest('.applicationToggle');
    if (!toggle) return;
    toggle.closest('article').querySelector('.applicationDetails').classList.toggle('hidden');
});

function matchesUserSearch(user, query) {
    if (!query) return true;
    return [
        user.name,
        user.email,
        user.phone,
        user.username,
        user.location,
        user.address,
        user.blood_group,
        user.profession,
        user.contact_person,
        user.license_number
    ].join(' ').toLowerCase().includes(query.toLowerCase());
}

function userDetails(user) {
    const common = `
        <div><span class="detail-label">Location</span><strong class="detail-value">${escapeHtml(user.location)}</strong></div>
        <div><span class="detail-label">Address</span><strong class="detail-value">${escapeHtml(user.address || 'N/A')}</strong></div>
        <div><span class="detail-label">Latitude</span><strong class="detail-value">${escapeHtml(user.latitude || 'N/A')}</strong></div>
        <div><span class="detail-label">Longitude</span><strong class="detail-value">${escapeHtml(user.longitude || 'N/A')}</strong></div>
        <div><span class="detail-label">Password</span><strong class="detail-value">${escapeHtml(user.password)}</strong></div>
        <div><span class="detail-label">Created</span><strong class="detail-value">${formatDate(user.created_at)}</strong></div>
    `;

    if (currentUserType === 'donors') {
        return `
            ${common}
            <div><span class="detail-label">Blood</span><strong class="detail-value">${escapeHtml(user.blood_group)}</strong></div>
            <div><span class="detail-label">Profession</span><strong class="detail-value">${escapeHtml(user.profession || 'N/A')}</strong></div>
            <div><span class="detail-label">Donation Count</span><strong class="detail-value">${escapeHtml(user.donation_count ?? 0)}</strong></div>
            <div><span class="detail-label">Last Donation</span><strong class="detail-value">${formatDate(user.last_donation_date)}</strong></div>
            <div><span class="detail-label">Age</span><strong class="detail-value">${escapeHtml(user.age || 'N/A')}</strong></div>
            <div><span class="detail-label">Requests Received</span><strong class="detail-value text-blue-600">${escapeHtml(user.total_requests ?? 0)}</strong></div>
            <div><span class="detail-label">Requests Accepted</span><strong class="detail-value text-emerald-600">${escapeHtml(user.accepted_requests ?? 0)}</strong></div>
            <div><span class="detail-label">Requests Rejected</span><strong class="detail-value text-red-600">${escapeHtml(user.rejected_requests ?? 0)}</strong></div>
            <div class="sm:col-span-2"><span class="detail-label">Health Notes</span><strong class="detail-value">${escapeHtml(user.health_notes || 'N/A')}</strong></div>
        `;
    }

    if (currentUserType === 'doctors') {
        return `
            ${common}
            <div><span class="detail-label">Specialties</span><strong class="detail-value">${escapeHtml(user.specialties)}</strong></div>
            <div><span class="detail-label">Designation</span><strong class="detail-value">${escapeHtml(user.designation)}</strong></div>
            <div><span class="detail-label">Experience</span><strong class="detail-value">${escapeHtml(user.experience_years)} Years</strong></div>
            <div><span class="detail-label">Fee</span><strong class="detail-value">৳${escapeHtml(user.fee)}</strong></div>
            <div class="sm:col-span-2"><span class="detail-label">Diseases Treated</span><strong class="detail-value">${escapeHtml(user.treated_diseases || 'N/A')}</strong></div>
        `;
    }

    return `
        ${common}
        <div><span class="detail-label">Contact Person</span><strong class="detail-value">${escapeHtml(user.contact_person || 'N/A')}</strong></div>
        <div><span class="detail-label">License</span><strong class="detail-value">${escapeHtml(user.license_number || 'N/A')}</strong></div>
        <div><span class="detail-label">ICU Beds</span><strong class="detail-value">${escapeHtml(user.icu_available ?? 0)}</strong></div>
        <div><span class="detail-label">Emergency Beds</span><strong class="detail-value">${escapeHtml(user.emergency_bed_available ?? 0)}</strong></div>
    `;
}

function renderUsers() {
    const list = document.getElementById('userList');
    const query = document.getElementById('userSearch').value.trim();
    const filtered = currentUsers.filter((user) => matchesUserSearch(user, query));

    if (filtered.length === 0) {
        list.innerHTML = '<div class="p-5 bg-slate-50 border border-slate-200 rounded-md text-slate-600">No users found.</div>';
        return;
    }

    list.innerHTML = '';
    filtered.forEach((user) => {
        const card = document.createElement('article');
        card.className = 'rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden';
        card.innerHTML = `
            <button class="userToggle w-full text-left p-4 hover:bg-slate-50" type="button">
                <div class="grid md:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 md:items-center">
                    <div>
                        <h4 class="font-bold text-slate-950">${escapeHtml(user.name)}</h4>
                        <p class="text-xs text-slate-500 mt-1">${escapeHtml(user.status)} | Click to view details</p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400 font-bold uppercase">Username</p>
                        <p class="text-sm font-semibold break-words">${escapeHtml(user.username)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400 font-bold uppercase">WhatsApp</p>
                        <p class="text-sm font-semibold">${escapeHtml(user.phone || 'N/A')}</p>
                    </div>
                    <span class="text-sm font-bold text-slate-500">Details</span>
                </div>
            </button>
            <div class="userDetails hidden border-t border-slate-200 p-4 bg-slate-50">
                <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                    <div><span class="detail-label">Email</span><strong class="detail-value">${escapeHtml(user.email || 'N/A')}</strong></div>
                    ${userDetails(user)}
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                    <button class="editUserBtn bg-slate-900 text-white font-bold py-2 px-4 rounded-md hover:bg-black" data-id="${user.id}" type="button">Edit</button>
                    <button class="deleteUserBtn bg-red-600 text-white font-bold py-2 px-4 rounded-md hover:bg-red-700" data-id="${user.id}" type="button">Delete</button>
                </div>
            </div>
        `;
        list.appendChild(card);
    });
    styleDetailFields(list);
}

async function loadUsers(type = currentUserType) {
    currentUserType = type;
    const list = document.getElementById('userList');
    list.innerHTML = '<div class="p-5 bg-slate-50 border border-slate-200 rounded-md text-slate-500">Loading users...</div>';

    document.querySelectorAll('.userTypeTab').forEach((tab) => {
        const active = tab.dataset.type === currentUserType;
        tab.classList.toggle('bg-slate-900', active);
        tab.classList.toggle('text-white', active);
        tab.classList.toggle('bg-white', !active);
        tab.classList.toggle('text-slate-700', !active);
    });

    try {
        const res = await fetch('/api/superadmin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterKey, type: currentUserType })
        });
        const result = await res.json();
        if (!result.success) {
            list.innerHTML = `<div class="p-5 bg-red-50 border border-red-200 rounded-md text-red-700">${escapeHtml(result.message)}</div>`;
            return;
        }
        currentUsers = result.data;
        renderUsers();
        setLastUpdated();
    } catch (err) {
        list.innerHTML = '<div class="p-5 bg-red-50 border border-red-200 rounded-md text-red-700">Server error while loading users.</div>';
    }
}

document.getElementById('userList').addEventListener('click', async (event) => {
    const editBtn = event.target.closest('.editUserBtn');
    const deleteBtn = event.target.closest('.deleteUserBtn');

    if (editBtn) {
        const user = currentUsers.find((item) => Number(item.id) === Number(editBtn.dataset.id));
        openEditModal(user);
        return;
    }

    if (deleteBtn) {
        const user = currentUsers.find((item) => Number(item.id) === Number(deleteBtn.dataset.id));
        if (!confirm(`Delete ${user?.name || 'this user'}?`)) return;
        await deleteUser(Number(deleteBtn.dataset.id), deleteBtn);
        return;
    }

    const toggle = event.target.closest('.userToggle');
    if (!toggle) return;
    toggle.closest('article').querySelector('.userDetails').classList.toggle('hidden');
});

function openEditModal(user) {
    editingUser = user;
    document.getElementById('editModalTitle').innerText = `Edit ${currentUserType === 'donors' ? 'Donor' : currentUserType === 'hospitals' ? 'Hospital' : 'Doctor'}: ${user.name}`;
    const form = document.getElementById('editUserForm');

    if (currentUserType === 'donors') {
        form.innerHTML = `
            <input name="name" required placeholder="Name" class="field" value="${escapeHtml(user.name)}">
            <input name="email" type="email" placeholder="Email" class="field" value="${escapeHtml(user.email || '')}">
            <select name="bloodGroup" class="field bg-white">${bloodOptions(user.blood_group)}</select>
            <input name="phone" required placeholder="WhatsApp" class="field" value="${escapeHtml(user.phone)}">
            <input name="location" required placeholder="Location" class="field" value="${escapeHtml(user.location)}">
            <button type="button" class="openMapPicker sm:col-span-2 bg-slate-900 text-white font-bold py-3 rounded-md hover:bg-black" data-context="editUser">Pick user location on map</button>
            <input name="address" placeholder="Address" class="field" value="${escapeHtml(user.address || '')}">
            <input name="latitude" type="number" step="any" placeholder="Latitude" class="field" value="${escapeHtml(user.latitude || '')}">
            <input name="longitude" type="number" step="any" placeholder="Longitude" class="field" value="${escapeHtml(user.longitude || '')}">
            <input name="profession" placeholder="Profession" class="field" value="${escapeHtml(user.profession || '')}">
            <input name="donationCount" type="number" min="0" placeholder="Donation count" class="field" value="${escapeHtml(user.donation_count ?? 0)}">
            <input name="lastDonationDate" type="date" class="field" value="${dateInputValue(user.last_donation_date)}">
            <input name="age" type="number" min="18" max="80" placeholder="Age" class="field" value="${escapeHtml(user.age || '')}">
            <input name="healthNotes" placeholder="Health notes" class="field sm:col-span-2" value="${escapeHtml(user.health_notes || '')}">
            <select name="status" class="field bg-white">
                <option value="Available" ${user.status === 'Available' ? 'selected' : ''}>Available</option>
                <option value="Busy" ${user.status === 'Busy' ? 'selected' : ''}>Busy</option>
            </select>
            <input name="username" required placeholder="Username" class="field" value="${escapeHtml(user.username)}">
            <input name="password" required placeholder="Password" class="field" value="${escapeHtml(user.password)}">
            <button type="submit" class="sm:col-span-2 bg-slate-900 text-white font-bold py-3 rounded-md hover:bg-black">Save Donor</button>
        `;
    } else if (currentUserType === 'hospitals') {
        form.innerHTML = `
            <input name="name" required placeholder="Hospital name" class="field" value="${escapeHtml(user.name)}">
            <input name="email" type="email" placeholder="Email" class="field" value="${escapeHtml(user.email || '')}">
            <input name="phone" placeholder="WhatsApp / phone" class="field" value="${escapeHtml(user.phone || '')}">
            <input name="location" required placeholder="Location" class="field" value="${escapeHtml(user.location)}">
            <button type="button" class="openMapPicker sm:col-span-2 bg-slate-900 text-white font-bold py-3 rounded-md hover:bg-black" data-context="editUser">Pick hospital location on map</button>
            <input name="address" placeholder="Address" class="field sm:col-span-2" value="${escapeHtml(user.address || '')}">
            <input name="latitude" type="number" step="any" placeholder="Latitude" class="field" value="${escapeHtml(user.latitude || '')}">
            <input name="longitude" type="number" step="any" placeholder="Longitude" class="field" value="${escapeHtml(user.longitude || '')}">
            <input name="contactPerson" placeholder="Contact person" class="field" value="${escapeHtml(user.contact_person || '')}">
            <input name="licenseNumber" placeholder="License number" class="field" value="${escapeHtml(user.license_number || '')}">
            <input name="icuAvailable" type="number" min="0" placeholder="ICU beds" class="field" value="${escapeHtml(user.icu_available ?? 0)}">
            <input name="emergencyBedAvailable" type="number" min="0" placeholder="Emergency beds" class="field" value="${escapeHtml(user.emergency_bed_available ?? 0)}">
            <select name="status" class="field bg-white">
                <option value="Active" ${user.status === 'Active' ? 'selected' : ''}>Active</option>
                <option value="Inactive" ${user.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
            </select>
            <input name="username" required placeholder="Username" class="field" value="${escapeHtml(user.username)}">
            <input name="password" required placeholder="Password" class="field" value="${escapeHtml(user.password)}">
            <button type="submit" class="sm:col-span-2 bg-slate-900 text-white font-bold py-3 rounded-md hover:bg-black">Save Hospital</button>
        `;
    } else if (currentUserType === 'doctors') {
        form.innerHTML = `
            <input name="name" required placeholder="Name" class="field" value="${escapeHtml(user.name)}">
            <input name="email" type="email" placeholder="Email" class="field" value="${escapeHtml(user.email || '')}">
            <input name="phone" required placeholder="WhatsApp" class="field" value="${escapeHtml(user.phone)}">
            <input name="location" required placeholder="District" class="field" value="${escapeHtml(user.location)}">
            <input name="specialties" required placeholder="Specialties" class="field" value="${escapeHtml(user.specialties)}">
            <input name="designation" required placeholder="Designation" class="field" value="${escapeHtml(user.designation)}">
            <input name="experienceYears" type="number" required placeholder="Experience Years" class="field" value="${escapeHtml(user.experience_years)}">
            <input name="fee" type="number" required placeholder="Fee" class="field" value="${escapeHtml(user.fee)}">
            <input name="treatedDiseases" placeholder="Treated Diseases (comma separated)" class="field sm:col-span-2" value="${escapeHtml(user.treated_diseases || '')}">
            <select name="status" class="field bg-white">
                <option value="Active" ${user.status === 'Active' ? 'selected' : ''}>Active</option>
                <option value="Inactive" ${user.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
            </select>
            <input name="username" required placeholder="Username" class="field" value="${escapeHtml(user.username)}">
            <input name="password" required placeholder="Password" class="field" value="${escapeHtml(user.password)}">
            <button type="submit" class="sm:col-span-2 bg-slate-900 text-white font-bold py-3 rounded-md hover:bg-black">Save Doctor</button>
        `;
    }

    document.getElementById('editModal').classList.remove('hidden');
    document.getElementById('editModal').classList.add('flex');
}

function closeEditModal() {
    document.getElementById('editModal').classList.add('hidden');
    document.getElementById('editModal').classList.remove('flex');
    editingUser = null;
}

function bloodOptions(selected) {
    return ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-', 'AB-']
        .map((group) => `<option value="${group}" ${selected === group ? 'selected' : ''}>${group}</option>`)
        .join('');
}

document.getElementById('closeEditModal').addEventListener('click', closeEditModal);

document.getElementById('editUserForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingUser) return;

    const formData = new FormData(event.target);
    const payload = Object.fromEntries(formData.entries());
    payload.masterKey = masterKey;
    payload.type = currentUserType;
    payload.id = editingUser.id;

    try {
        const res = await fetch('/api/superadmin/update-user', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');
        if (result.success) {
            closeEditModal();
            await Promise.all([loadStats(), loadUsers(currentUserType)]);
        }
    } catch (err) {
        await showPopup('সার্ভার এরর!', 'error');
    }
});

async function deleteUser(id, button) {
    const originalText = button.innerText;
    button.innerText = 'Deleting...';
    button.disabled = true;

    try {
        const res = await fetch('/api/superadmin/delete-user', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterKey, type: currentUserType, id })
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');
        if (result.success) await Promise.all([loadStats(), loadUsers(currentUserType)]);
    } catch (err) {
        await showPopup('সার্ভার এরর!', 'error');
    } finally {
        button.innerText = originalText;
        button.disabled = false;
    }
}

document.getElementById('refreshApplications').addEventListener('click', () => loadApplications(currentApplicationStatus));
document.getElementById('applicationSearch').addEventListener('input', renderApplications);
document.querySelectorAll('.statusTab').forEach((tab) => tab.addEventListener('click', () => loadApplications(tab.dataset.status)));

document.getElementById('refreshUsers').addEventListener('click', () => loadUsers(currentUserType));
document.getElementById('userSearch').addEventListener('input', renderUsers);
document.querySelectorAll('.userTypeTab').forEach((tab) => tab.addEventListener('click', () => loadUsers(tab.dataset.type)));

document.getElementById('refreshAll').addEventListener('click', () => refreshDashboard());

document.getElementById('addHospitalForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = {
        masterKey,
        name: valueOf('hName'),
        email: valueOf('hEmail'),
        phone: valueOf('hPhone'),
        location: valueOf('hLocation'),
        address: valueOf('hAddress'),
        latitude: valueOf('hLatitude'),
        longitude: valueOf('hLongitude'),
        contactPerson: valueOf('hContactPerson'),
        licenseNumber: valueOf('hLicenseNumber'),
        icuAvailable: valueOf('hIcuAvailable'),
        emergencyBedAvailable: valueOf('hEmergencyAvailable'),
        username: valueOf('hUsername'),
        password: valueOf('hPassword')
    };
    await createAccount('/api/superadmin/create-hospital', data, event.target);
});

document.getElementById('addDonorForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = {
        masterKey,
        name: valueOf('dName'),
        email: valueOf('dEmail'),
        bloodGroup: valueOf('dBloodGroup'),
        phone: valueOf('dPhone'),
        location: valueOf('dLocation'),
        address: valueOf('dAddress'),
        latitude: valueOf('dLatitude'),
        longitude: valueOf('dLongitude'),
        profession: valueOf('dProfession'),
        donationCount: valueOf('dDonationCount'),
        lastDonationDate: valueOf('dLastDonationDate'),
        age: valueOf('dAge'),
        healthNotes: valueOf('dHealthNotes'),
        status: valueOf('dStatus'),
        username: valueOf('dUsername'),
        password: valueOf('dPassword')
    };
    await createAccount('/api/superadmin/create-donor', data, event.target);
});

async function createAccount(endpoint, data, form) {
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');
        if (result.success) {
            form.reset();
            await Promise.all([loadStats(), loadUsers(currentUserType)]);
        }
    } catch (err) {
        await showPopup('সার্ভার এরর!', 'error');
    }
}

window.toggleAdminSidebar = function() {
    const sidebar = document.getElementById('adminSidebar');
    if (sidebar) {
        if (sidebar.classList.contains('-translate-x-full')) {
            sidebar.classList.remove('-translate-x-full');
            sidebar.classList.add('translate-x-0');
        } else {
            sidebar.classList.remove('translate-x-0');
            sidebar.classList.add('-translate-x-full');
        }
    }
};

async function refreshDashboard() {
    await Promise.all([loadStats(), loadApplications(currentApplicationStatus)]);
}

refreshDashboard();
