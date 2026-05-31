// সিকিউরিটি চেক ও ডেটা লোড
let userData = JSON.parse(localStorage.getItem('userData'));

if (localStorage.getItem('userRole') !== 'donor' || !userData) {
    window.location.href = '/login';
    throw new Error('Unauthorized donor dashboard access');
}

// ডোনারের নাম নেভবারে দেখানো
// Status dropdown will be set once we fetch live status from DB below
document.getElementById('donorNameDisplay').innerText = `🩸 ${userData.name}`;
// Optimistic default from localStorage (will be corrected by DB fetch below)
document.getElementById('donorStatus').value = userData.status || 'Available';

// Set existing data in the profile update form
document.getElementById('dPhone').value = userData.phone || '';
document.getElementById('dAge').value = userData.age || '';
document.getElementById('dProfession').value = userData.profession || '';
// Geographical population and selection are handled at the bottom of the script

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
}

function updateProfileDisplay() {
    const row = (key, val) => `
        <div class="profile-row">
            <span class="key">${key}</span>
            <span class="val">${escapeHtml(val || 'N/A')}</span>
        </div>`;
    document.getElementById('donorProfile').innerHTML = `
        ${row('📧 ইমেইল', userData.email)}
        ${row('📱 ফোন', userData.phone)}
        ${row('🩸 রক্তের গ্রুপ', userData.blood_group)}
        ${row('💼 পেশা', userData.profession)}
        ${row('🎂 বয়স', userData.age)}
        ${row('💉 ডোনেশন সংখ্যা', userData.donation_count ?? 0)}
        ${row('📅 সর্বশেষ ডোনেশন', userData.last_donation_date)}
        ${row('📍 জেলা/উপজেলা', userData.location)}
        ${row('🗺️ ঠিকানা', userData.address)}
    `;
}
updateProfileDisplay();

function logout() {
    localStorage.clear();
    window.location.href = '/login';
}

// স্ট্যাটাস আপডেট লজিক
document.getElementById('updateStatusForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('donorStatus').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = 'আপডেট হচ্ছে...';
    submitBtn.disabled = true;

    try {
        const res = await fetch('/api/donor/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ donorId: userData.id, status })
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');

        if (result.success) {
            // Use the CONFIRMED status returned by the server, not the form value
            const confirmedStatus = result.status || status;
            userData.status = confirmedStatus;
            localStorage.setItem('userData', JSON.stringify(userData));
            document.getElementById('donorStatus').value = confirmedStatus;
            renderStatusWarning(confirmedStatus);
        }
    } catch (err) {
        await showPopup('সার্ভার এরর!', 'error');
    } finally {
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
});

// বিজি অবস্থার সতর্কতা বার্তা
function renderStatusWarning(status) {
    const existing = document.getElementById('statusWarningBanner');
    if (existing) existing.remove();
    if (status !== 'Busy') return;
    const banner = document.createElement('div');
    banner.id = 'statusWarningBanner';
    banner.style.cssText = 'margin-top:12px;padding:10px 14px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);border-radius:10px;color:#f87171;font-size:.85rem;font-weight:600;';
    banner.innerHTML = '⚠️ আপনার স্ট্যাটাস বিজি রয়েছে। নতুন ইমার্জেন্সি রিকোয়েস্ট আসবে না।';
    document.getElementById('updateStatusForm').after(banner);
}

// পেজ লোডে ডাটাবেস থেকে লাইভ স্ট্যাটাস ফেচ করা
(async () => {
    try {
        const res = await fetch(`/api/donor/status?donorId=${userData.id}`);
        const result = await res.json();
        if (result.success) {
            const liveStatus = result.status;
            document.getElementById('donorStatus').value = liveStatus;
            userData.status = liveStatus;
            localStorage.setItem('userData', JSON.stringify(userData));
            renderStatusWarning(liveStatus);
        }
    } catch (e) {
        console.warn('লাইভ স্ট্যাটাস ফেচ ব্যর্থ হয়েছে, লোকাল ক্যাশ ব্যবহার হচ্ছে।', e);
        renderStatusWarning(userData.status);
    }
})();

// Parse location bulletproofly
let selectedDistrict = '';
let selectedUpazila = '';
if (userData.location) {
    if (userData.location.includes(',')) {
        const parts = userData.location.split(',').map(s => s.trim());
        if (parts.length >= 2) {
            selectedUpazila = parts[0];
            selectedDistrict = parts[1];
        } else {
            selectedDistrict = parts[0];
        }
    } else {
        selectedDistrict = userData.location;
    }
}

populateDivisions('dLocationName', selectedDistrict);
if (selectedDistrict) {
    populateUpazilas('dLocationName', 'dUpazila', selectedUpazila);
}

// Map Integration
let selectedLocation = {
    latitude: parseFloat(userData.latitude) || 23.8103,
    longitude: parseFloat(userData.longitude) || 90.4125,
    address: userData.address || 'Dhaka, Bangladesh'
};

const selectedLocationText = document.getElementById('selectedLocationText');
const dLocationName = document.getElementById('dLocationName');

function setSelectedLocation({ latitude, longitude, address }) {
    selectedLocation = { latitude, longitude, address: address || `${latitude}, ${longitude}` };
    selectedLocationText.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        <span style="color:rgba(255,255,255,.6)">📍 ${escapeHtml(address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)}</span>
    `;
}

function initMap() {
    if (typeof mapboxgl === 'undefined') return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
        container: 'locationMap',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [selectedLocation.longitude, selectedLocation.latitude],
        zoom: userData.latitude ? 14 : 11,
        maxBounds: [[85, 19], [94, 28]]
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false
    }), 'top-right');

    // Draggable marker
    let markerEl = document.createElement('div');
    markerEl.style.cssText = 'width:20px;height:20px;background:#dc2626;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:grab;';
    const marker = new mapboxgl.Marker({ element: markerEl, anchor: 'bottom', draggable: true })
        .setLngLat([selectedLocation.longitude, selectedLocation.latitude])
        .addTo(map);

    marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        setSelectedLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address: 'Dragged' });
        if (typeof mapboxReverseGeocode === 'function') {
            mapboxReverseGeocode(lngLat.lat, lngLat.lng).then(geo => {
                autoFillFromGeocode('dLocationName', 'dUpazila', geo);
                if (geo.displayName) setSelectedLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address: geo.displayName });
            });
        }
    });

    function moveMarker(lngLat, address) {
        marker.setLngLat([lngLat.lng, lngLat.lat]);
        map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 15 });
        setSelectedLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address });
    }

    map.on('click', e => {
        moveMarker(e.lngLat, 'Manual selection');
        if (typeof mapboxReverseGeocode === 'function') {
            mapboxReverseGeocode(e.lngLat.lat, e.lngLat.lng).then(geo => {
                autoFillFromGeocode('dLocationName', 'dUpazila', geo);
                if (geo.displayName) setSelectedLocation({ latitude: e.lngLat.lat, longitude: e.lngLat.lng, address: geo.displayName });
            });
        }
    });

    // My Location button
    const findBtn = document.getElementById('findLocationBtnInside');
    if (findBtn) {
        findBtn.addEventListener('click', () => {
            const originalText = findBtn.innerHTML;
            findBtn.textContent = 'খুঁজছে...';
            getGeolocationWithIPFallback().then(
                coords => {
                    const lngLat = { lat: coords.lat, lng: coords.lng };
                    map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 15 });
                    if (typeof mapboxReverseGeocode === 'function') {
                        mapboxReverseGeocode(lngLat.lat, lngLat.lng).then(geo => {
                            moveMarker(lngLat, geo.displayName || 'Current location');
                            autoFillFromGeocode('dLocationName', 'dUpazila', geo);
                            findBtn.innerHTML = originalText;
                        });
                    } else {
                        moveMarker(lngLat, 'Current location');
                        findBtn.innerHTML = originalText;
                    }
                }
            ).catch(() => {
                showToast('লোকেশন পাওয়া যায়নি। অনুগ্রহ করে ম্যাপে ম্যানুয়ালি ক্লিক করুন।', 'warning');
                findBtn.innerHTML = originalText;
            });
        });
    }

    // ── Donor Map Search ──
    const searchInput   = document.getElementById('donorMapSearch');
    const searchResults = document.getElementById('donorSearchResults');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const q = searchInput.value.trim();
            if (q.length < 2) { searchResults.innerHTML = ''; searchResults.classList.remove('show'); return; }
            searchTimeout = setTimeout(async () => {
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&country=BD&language=en&limit=5`;
                const res = await fetch(url);
                const data = await res.json();
                searchResults.innerHTML = '';
                if (data.features && data.features.length) {
                    data.features.forEach(f => {
                        const item = document.createElement('div');
                        item.className = 'donor-search-item';
                        item.textContent = f.place_name;
                        item.addEventListener('click', () => {
                            const [lng, lat] = f.center;
                            map.flyTo({ center: [lng, lat], zoom: 14 });
                            moveMarker({ lat, lng }, f.place_name);
                            if (typeof mapboxReverseGeocode === 'function') {
                                mapboxReverseGeocode(lat, lng).then(geo => autoFillFromGeocode('dLocationName', 'dUpazila', geo));
                            }
                            searchInput.value = f.place_name;
                            searchResults.classList.remove('show');
                        });
                        searchResults.appendChild(item);
                    });
                    searchResults.classList.add('show');
                }
            }, 350);
        });
        document.addEventListener('click', e => { if (!searchInput.contains(e.target)) searchResults.classList.remove('show'); });
    }

    setSelectedLocation(selectedLocation);
}

// Load map when ready
window.addEventListener('load', () => {
    if (typeof mapboxgl !== 'undefined') initMap();
});

// Update Profile
document.getElementById('updateProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const upz = document.getElementById('dUpazila').value;
    const locVal = upz ? `${upz}, ${dLocationName.value}` : dLocationName.value;
    
    const phone = document.getElementById('dPhone').value.trim();
    const age = document.getElementById('dAge').value.trim();
    const profession = document.getElementById('dProfession').value.trim();

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('880')) {
        cleanPhone = cleanPhone.substring(2);
    }
    const bdRegex = /^01[3-9]\d{8}$/;
    if (!bdRegex.test(cleanPhone)) {
        await showPopup('একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।', 'error');
        return;
    }

    let parsedAge = null;
    if (age) {
        parsedAge = parseInt(age, 10);
        if (isNaN(parsedAge) || parsedAge < 18 || parsedAge > 80) {
            await showPopup('ডোনারের বয়স ১৮ থেকে ৮০ এর মধ্যে হতে হবে।', 'error');
            return;
        }
    }

    if (profession && profession.length < 2) {
        await showPopup('পেশা সঠিকভাবে লিখুন (কমপক্ষে ২ অক্ষর)।', 'error');
        return;
    }

    // Update input field display
    document.getElementById('dPhone').value = cleanPhone;

    const payload = {
        donorId: userData.id,
        phone: cleanPhone,
        age: parsedAge,
        profession: profession,
        location: locVal,
        address: selectedLocation.address,
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = 'আপডেট হচ্ছে...';
    submitBtn.disabled = true;

    try {
        const res = await fetch('/api/donor/update-profile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');

        if (result.success && result.donorData) {
            userData = result.donorData;
            localStorage.setItem('userData', JSON.stringify(userData));
            updateProfileDisplay();
        }
    } catch (err) {
        await showPopup('সার্ভার এরর!', 'error');
    } finally {
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
});

// Fetch and display requests
let countdownInterval = null;
let _pollInterval = null;
let _lastPendingCount = 0;

async function loadRequests() {
    try {
        // Use web-pending endpoint (works even without FCM/app login)
        const [allRes, pendingRes] = await Promise.all([
            fetch('/api/donor/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ donorId: userData.id })
            }),
            fetch('/api/donor/web-pending', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ donorId: userData.id })
            })
        ]);

        const result = await allRes.json();
        const pendingResult = await pendingRes.json();

        // Show pending alert banner if there are pending requests
        const pendingCount = pendingResult.count || 0;
        updatePendingAlertBanner(pendingCount, pendingResult.data || []);

        if (result.success) {
            const reqs = result.data;
            document.getElementById('totalReqs').innerText = reqs.length;
            document.getElementById('acceptedReqs').innerText = reqs.filter(r => r.response_status === 'Accepted').length;
            document.getElementById('rejectedReqs').innerText = reqs.filter(r => r.response_status === 'Rejected').length;
            
            const list = document.getElementById('requestsList');
            list.innerHTML = '';
            
            if (reqs.length === 0) {
                list.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="icon">🩸</div><p>এখনো কোনো রিকোয়েস্ট আসেনি।</p></div>`;
                return;
            }


            // সর্ট: Pending → Accepted (৫ ঘন্টার মধ্যে) → পুরনো Accepted → Rejected
            const now = Date.now();
            const FIVE_HOURS = 5 * 60 * 60 * 1000;

            reqs.sort((a, b) => {
                function getPriority(req) {
                    if (req.response_status === 'Pending') return 1;
                    if (req.response_status === 'Accepted') {
                        const age = now - new Date(req.responded_at || req.notified_at || req.created_at).getTime();
                        return age <= FIVE_HOURS ? 2 : 3;
                    }
                    if (req.response_status === 'Rejected') return 4;
                    return 5;
                }
                const pA = getPriority(a);
                const pB = getPriority(b);
                if (pA !== pB) return pA - pB;
                return new Date(b.created_at) - new Date(a.created_at);
            });


            if (countdownInterval) clearInterval(countdownInterval);

            reqs.forEach(req => {
                const date = new Date(req.created_at).toLocaleString('bn-BD');
                const timerStart = req.notified_at || req.created_at;
                const isPending  = req.response_status === 'Pending';
                const isAccepted = req.response_status === 'Accepted';
                const isRejected = req.response_status === 'Rejected';


                // Status badge
                let statusBadge = '';
                if (isPending)  statusBadge = `<span class="status-badge pending">⏳ অপেক্ষমান</span>`;
                if (isAccepted) statusBadge = `<span class="status-badge accepted">✅ গৃহীত</span>`;
                if (isRejected) statusBadge = `<span class="status-badge rejected">❌ বাতিল</span>`;

                // Countdown (Pending = 5min timer | Accepted within 5h = top-priority timer)
                let countdownHtml = '';
                if (isPending) {
                    countdownHtml = `<div class="countdown-pill">⏱️ সময় বাকি: <span class="countdown-timer" data-created="${timerStart}" data-id="${req.request_id}">...</span></div>`;
                } else if (isAccepted) {
                    const ageMs = now - new Date(req.responded_at || timerStart).getTime();
                    if (ageMs <= FIVE_HOURS) {
                        countdownHtml = `<div class="countdown-pill" style="background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.3);color:#4ade80;">🔝 টপে আছে: <span class="accepted-timer" data-created="${req.responded_at || timerStart}">...</span></div>`;
                    }
                }

                // Actions
                let actionsHtml = '';
                if (isPending) {
                    actionsHtml = `
                        <div id="actions-${req.request_id}" class="flex gap-3 mt-4">
                            <button onclick="handleRequest(${req.request_id}, 'Accepted')" class="btn-accept">✅ গ্রহণ করুন</button>
                            <button onclick="handleRequest(${req.request_id}, 'Rejected')" class="btn-reject">❌ বাতিল</button>
                        </div>`;
                } else if (isAccepted && req.contact_number) {
                    actionsHtml = `
                        <div class="contact-box">
                            <span style="font-size:1.3rem">📞</span>
                            <div>
                                <div style="color:rgba(255,255,255,.4);font-size:.75rem;font-weight:600;">রোগীর নম্বর</div>
                                <a href="tel:${escapeHtml(req.contact_number)}">${escapeHtml(req.contact_number)}</a>
                            </div>
                        </div>`;
                }

                // Card class
                const cardClass = isPending ? 'pending' : isAccepted ? 'accepted' : isRejected ? 'rejected' : 'noresponse';


                list.innerHTML += `
                    <div class="req-card ${cardClass} p-5">
                        <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
                            <span class="blood-badge">🩸 ${escapeHtml(req.blood_group)}</span>
                            ${statusBadge}
                        </div>
                        <div style="color:rgba(255,255,255,.3);font-size:.75rem;margin-bottom:10px;">${date}</div>
                        <div class="req-info-row">
                            <span class="icon">🏥</span>
                            <div><div class="label">হাসপাতাল</div><div class="val">${escapeHtml(req.hospital_name)}</div></div>
                        </div>
                        <div class="req-info-row">
                            <span class="icon">📍</span>
                            <div><div class="label">লোকেশন</div><div class="val">${escapeHtml(req.location)}</div></div>
                        </div>
                        <div class="req-info-row">
                            <span class="icon">⏰</span>
                            <div><div class="label">সময়</div><div class="val">${escapeHtml(req.needed_time)}</div></div>
                        </div>
                        <div class="req-info-row">
                            <span class="icon">🤒</span>
                            <div><div class="label">রোগীর ধরন</div><div class="val">${escapeHtml(req.patient_disease)}</div></div>
                        </div>
                        ${countdownHtml}
                        ${actionsHtml}
                    </div>
                `;
            });


            // কাউন্টডাউন শুরু করা
            startCountdowns();
        }
    } catch (err) {
        console.error("Error loading requests:", err);
    }
}

function startCountdowns() {
    function updateTimers() {
        const nowTs = new Date().getTime();

        // ── Pending 5-min countdown ──
        document.querySelectorAll('.countdown-timer').forEach(el => {
            let createdAt = new Date(el.dataset.created).getTime();
            if (isNaN(createdAt)) return;
            
            const expireTime = createdAt + (5 * 60 * 1000);
            const diff = expireTime - nowTs;

            if (diff <= 0) {
                el.innerText = 'No Response';
                const pill = el.closest('.countdown-pill');
                if (pill) { pill.style.background = 'rgba(107,114,128,.12)'; pill.style.borderColor = 'rgba(107,114,128,.25)'; pill.style.color = '#9ca3af'; }
                
                const btnGroup = document.getElementById(`actions-${el.dataset.id}`);
                if (btnGroup) {
                    btnGroup.innerHTML = `<div class="status-badge noresponse" style="margin-top:10px;">⏳ No Response</div>`;
                }
            } else {
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                el.innerText = `${minutes} মি ${seconds} সে`;
            }
        });

        // ── Accepted 5-hour top-priority countdown ──
        document.querySelectorAll('.accepted-timer').forEach(el => {
            let createdAt = new Date(el.dataset.created).getTime();
            if (isNaN(createdAt)) return;

            const expireTime = createdAt + (5 * 60 * 60 * 1000); // 5 hours
            const diff = expireTime - nowTs;

            if (diff <= 0) {
                // কার্ড আর টপে থাকবে না — পেজ রিলোড করলে নিচে চলে যাবে
                const pill = el.closest('.countdown-pill');
                if (pill) pill.style.display = 'none';
                loadRequests(); // re-sort and re-render
            } else {
                const hours   = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                el.innerText = `${hours} ঘ ${minutes} মি বাকি`;
            }
        });
    }

    updateTimers();
    countdownInterval = setInterval(updateTimers, 1000);
}

window.handleRequest = async function(requestId, status) {
    if (!confirm('আপনি কি নিশ্চিত?')) return;
    
    try {
        const res = await fetch('/api/donor/request-response', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ donorId: userData.id, requestId, status })
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');
        if (result.success) loadRequests();
    } catch (err) {
        await showPopup('সার্ভার এরর!', 'error');
    }
};

/**
 * Pending Alert Banner — web e login thakleo na thakleo, request eshe gele
 * dashboard-er top-e ekta red alert banner dekhabe.
 * Login chara = only possible if donorId jana thake (localStorage).
 */
function updatePendingAlertBanner(count, pendingReqs) {
    let banner = document.getElementById('pendingAlertBanner');

    // Update browser tab title with count
    if (count > 0) {
        document.title = `(${count}) 🚨 রক্তের রিকোয়েস্ট! - LifeLine`;
    } else {
        document.title = 'ডোনার ড্যাশবোর্ড - LifeLine';
    }

    // If no pending, hide the banner
    if (count === 0) {
        if (banner) banner.style.display = 'none';
        return;
    }

    // Show browser notification if new request arrived
    if (count > _lastPendingCount && _lastPendingCount >= 0) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🚨 জরুরি রক্তের প্রয়োজন!', {
                body: `আপনার কাছে ${count}টি নতুন রক্তের রিকোয়েস্ট এসেছে!`,
                icon: '/favicon.ico',
                requireInteraction: true,
                tag: 'blood-request'
            });
        }
    }
    _lastPendingCount = count;

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'pendingAlertBanner';
        banner.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
            background: linear-gradient(135deg, #7f1d1d, #dc2626);
            color: #fff; padding: 14px 20px;
            display: flex; align-items: center; justify-content: center; gap: 16px;
            font-weight: 700; font-size: .95rem;
            box-shadow: 0 4px 20px rgba(220,38,38,.6);
            animation: slideDown .4s ease;
        `;
        document.body.prepend(banner);
        // Add animation
        const style = document.createElement('style');
        style.textContent = `@keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        document.head.appendChild(style);
    }

    // Build request summary
    const firstReq = pendingReqs[0];
    const bloodInfo = firstReq ? `🩸 ${firstReq.blood_group} — ${firstReq.hospital_name || firstReq.location}` : '';
    banner.innerHTML = `
        <span style="font-size:1.4rem;">🚨</span>
        <div>
            <div>${count}টি জরুরি রক্তের রিকোয়েস্ট অপেক্ষা করছে!</div>
            ${bloodInfo ? `<div style="font-size:.82rem;opacity:.85;margin-top:2px;">${escapeHtml(bloodInfo)}</div>` : ''}
        </div>
        <button onclick="document.getElementById('requestsList').scrollIntoView({behavior:'smooth'})"
            style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;white-space:nowrap;">
            📋 দেখুন
        </button>
        <button onclick="document.getElementById('pendingAlertBanner').style.display='none'"
            style="background:none;border:none;color:rgba(255,255,255,.7);font-size:1.4rem;cursor:pointer;line-height:1;padding:0 4px;">
            ×
        </button>
    `;
    banner.style.display = 'flex';
}

// Request browser notification permission on page load
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
}

// Auto-refresh every 20 seconds to check for new pending requests
// This ensures donors see requests even if FCM/app push fails
function startPolling() {
    if (_pollInterval) clearInterval(_pollInterval);
    _pollInterval = setInterval(() => {
        loadRequests();
    }, 20000); // 20 seconds
}

// Call load requests
loadRequests();
startPolling();

