
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
}

const applicationType = document.getElementById('applicationType');
const donorFields = document.getElementById('donorFields');
const hospitalFields = document.getElementById('hospitalFields');
const selectedLocationText = document.getElementById('selectedLocationText');
const appLocation = document.getElementById('appLocation');

let selectedLocation = {
    latitude: 23.8103,
    longitude: 90.4125,
    address: 'Dhaka, Bangladesh'
};

function updateTypeFields() {
    const isDonor = applicationType.value === 'donor';
    donorFields.classList.toggle('hidden', !isDonor);
    hospitalFields.classList.toggle('hidden', isDonor);

    document.getElementById('donorProfession').required = isDonor;
    document.getElementById('donorDonationCount').required = isDonor;
    document.getElementById('hospitalContactPerson').required = !isDonor;
    document.getElementById('hospitalLicense').required = !isDonor;
}

function setSelectedLocation({ latitude, longitude, address }) {
    selectedLocation = { latitude, longitude, address: address || `${latitude}, ${longitude}` };
    selectedLocationText.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>
        <span>Selected: <strong>${escapeHtml(selectedLocation.address)}</strong> (${latitude.toFixed(5)}, ${longitude.toFixed(5)})</span>
    `;

    // Auto-fill district/upazila from Mapbox geocode result
    if (typeof mapboxReverseGeocode === 'function') {
        mapboxReverseGeocode(latitude, longitude).then(geo => {
            autoFillFromGeocode('appLocation', 'appUpazila', geo);
        });
    }
}

// ─── Mapbox Map Initialization ───
function initMap(startLat, startLng) {
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const centerLat = startLat || selectedLocation.latitude;
    const centerLng = startLng || selectedLocation.longitude;
    const startZoom = startLat ? 14 : 7; // zoom in if we have real GPS, else show all BD

    const map = new mapboxgl.Map({
        container: 'locationMap',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [centerLng, centerLat],
        zoom: startZoom,
        maxBounds: [[85, 19], [94, 28]]
    });

    window.map = map;

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Draggable marker
    let markerEl = document.createElement('div');
    markerEl.style.cssText = 'width:22px;height:22px;background:#dc2626;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:grab;';

    const marker = new mapboxgl.Marker({ element: markerEl, anchor: 'bottom', draggable: true })
        .setLngLat([centerLng, centerLat])
        .addTo(map);

    // If we started at real GPS, do geocode immediately
    if (startLat && startLng) {
        mapboxReverseGeocode(startLat, startLng).then(geo => {
            autoFillFromGeocode('appLocation', 'appUpazila', geo);
            const addr = geo.displayName || `${startLat.toFixed(5)}, ${startLng.toFixed(5)}`;
            selectedLocation = { latitude: startLat, longitude: startLng, address: addr };
            setSelectedLocation(selectedLocation);
        });
    }

    marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        mapboxReverseGeocode(lngLat.lat, lngLat.lng).then(geo => {
            autoFillFromGeocode('appLocation', 'appUpazila', geo);
            const addr = geo.displayName || 'Dragged map selection';
            selectedLocation.address = addr;
            setSelectedLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address: addr });
        });
    });

    function moveMarker(lngLat, address) {
        marker.setLngLat([lngLat.lng, lngLat.lat]);
        map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 15 });
        setSelectedLocation({ latitude: lngLat.lat, longitude: lngLat.lng, address });
    }

    map.on('click', e => {
        mapboxReverseGeocode(e.lngLat.lat, e.lngLat.lng).then(geo => {
            const addr = geo.displayName || 'Manual map selection';
            moveMarker(e.lngLat, addr);
            autoFillFromGeocode('appLocation', 'appUpazila', geo);
        });
    });

    // ── আমার অবস্থান খুঁজুন button ──
    const findBtn = document.getElementById('findLocationBtnInside');
    if (findBtn) {
        findBtn.addEventListener('click', () => {
            const originalHTML = findBtn.innerHTML;
            findBtn.innerHTML = '<span style="animation:spin 1s linear infinite;display:inline-block">⏳</span> খুঁজছে...';
            findBtn.disabled = true;

            getGeolocationWithIPFallback().then(
                coords => {
                    const lat = coords.lat;
                    const lng = coords.lng;
                    map.flyTo({ center: [lng, lat], zoom: 16 });
                    marker.setLngLat([lng, lat]);
                    mapboxReverseGeocode(lat, lng).then(geo => {
                        const addr = geo.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                        setSelectedLocation({ latitude: lat, longitude: lng, address: addr });
                        autoFillFromGeocode('appLocation', 'appUpazila', geo);
                        findBtn.innerHTML = originalHTML;
                        findBtn.disabled = false;
                    });
                }
            ).catch(() => {
                typeof showToast === 'function' ? showToast('লোকেশন পাওয়া যায়নি। অনুগ্রহ করে ম্যাপে ম্যানুয়ালি ক্লিক করুন।', 'warning') : showPopup('লোকেশন পাওয়া যায়নি। অনুগ্রহ করে ম্যাপে ম্যানুয়ালি ক্লিক করুন।', 'warning');
                findBtn.innerHTML = originalHTML;
                findBtn.disabled = false;
            });
        });
    }

    // ── Map Search ──
    const searchInput   = document.getElementById('applyMapSearch');
    const searchResults = document.getElementById('applySearchResults');
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
                        item.className = 'map-search-item';
                        item.textContent = f.place_name;
                        item.addEventListener('click', () => {
                            const [lng, lat] = f.center;
                            map.flyTo({ center: [lng, lat], zoom: 15 });
                            moveMarker({ lat, lng }, f.place_name);
                            mapboxReverseGeocode(lat, lng).then(geo => {
                                autoFillFromGeocode('appLocation', 'appUpazila', geo);
                            });
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

    // Initial location display
    setSelectedLocation(selectedLocation);
}

applicationType.addEventListener('change', updateTypeFields);
updateTypeFields();

// Initialize map: try to get real GPS first (with IP fallback), then fallback to Bangladesh center
window.addEventListener('load', () => {
    if (typeof mapboxgl === 'undefined') return;

    // Show map immediately at BD center, then fly to real location
    initMap(null, null);
    getGeolocationWithIPFallback().then(coords => {
        const lat = coords.lat;
        const lng = coords.lng;
        // Only update if within Bangladesh bounds
        if (lat >= 20.5 && lat <= 26.8 && lng >= 87.9 && lng <= 92.8) {
            mapboxgl.accessToken = MAPBOX_TOKEN;
            document.getElementById('locationMap').innerHTML = '';
            initMap(lat, lng);
        }
    }).catch(() => {
        // Fallback or permission denied — map is already showing BD center
    });
});


document.getElementById('applicationForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const type = applicationType.value;
    const name = document.getElementById('appName').value.trim();
    const email = document.getElementById('appEmail').value.trim();
    const password = document.getElementById('appPassword').value.trim();
    const phone = document.getElementById('appPhone').value.trim();

    const nameRegex = /^[\u0980-\u09FFa-zA-Z\s.-]{2,50}$/;
    if (!nameRegex.test(name)) {
        await showPopup('একটি সঠিক নাম দিন (২-৫০ অক্ষরের মধ্যে, শুধু অক্ষর, ডট বা স্পেস)।', 'error');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        await showPopup('একটি সঠিক ইমেইল এড্রেস দিন।', 'error');
        return;
    }

    if (password.length < 6) {
        await showPopup('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।', 'error');
        return;
    }

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('880')) {
        cleanPhone = cleanPhone.substring(2);
    }
    const bdRegex = /^01[3-9]\d{8}$/;
    if (!bdRegex.test(cleanPhone)) {
        await showPopup('একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।', 'error');
        return;
    }

    const payload = {
        type,
        name,
        email,
        password,
        phone: cleanPhone,
        location: document.getElementById('appUpazila').value ? `${document.getElementById('appUpazila').value}, ${appLocation.value}` : appLocation.value,
        address: selectedLocation.address,
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude
    };

    if (type === 'donor') {
        const bloodGroup = document.getElementById('donorBloodGroup').value;
        const profession = document.getElementById('donorProfession').value.trim();
        const donationCount = document.getElementById('donorDonationCount').value.trim();
        const age = document.getElementById('donorAge').value.trim();

        const ALLOWED_BLOOD_GROUPS = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-', 'AB-'];
        if (!ALLOWED_BLOOD_GROUPS.includes(bloodGroup)) {
            await showPopup('রক্তের গ্রুপ নির্বাচন করুন।', 'error');
            return;
        }

        if (profession.length < 2) {
            await showPopup('পেশা সঠিকভাবে লিখুন (কমপক্ষে ২ অক্ষর)।', 'error');
            return;
        }

        const countVal = parseInt(donationCount, 10);
        if (isNaN(countVal) || countVal < 0) {
            await showPopup('রক্তদানের সংখ্যা অবশ্যই ০ বা তার বেশি হতে হবে।', 'error');
            return;
        }

        const ageVal = parseInt(age, 10);
        if (isNaN(ageVal) || ageVal < 18 || ageVal > 80) {
            await showPopup('ডোনারের বয়স ১৮ থেকে ৮০ এর মধ্যে হতে হবে।', 'error');
            return;
        }

        Object.assign(payload, {
            bloodGroup,
            profession,
            donationCount: countVal,
            lastDonationDate: document.getElementById('donorLastDonation').value,
            age: ageVal,
            healthNotes: document.getElementById('donorHealthNotes').value
        });
    } else {
        const contactPerson = document.getElementById('hospitalContactPerson').value.trim();
        const licenseNumber = document.getElementById('hospitalLicense').value.trim();
        const icu = document.getElementById('hospitalIcu').value.trim();
        const emergency = document.getElementById('hospitalEmergency').value.trim();

        if (!nameRegex.test(contactPerson)) {
            await showPopup('যোগাযোগের ব্যক্তির নাম সঠিক নয় (২-৫০ অক্ষরের মধ্যে, শুধু অক্ষর, ডট বা স্পেস)।', 'error');
            return;
        }

        if (!licenseNumber) {
            await showPopup('লাইসেন্স নাম্বার দিন।', 'error');
            return;
        }

        const icuVal = parseInt(icu, 10);
        const emergencyVal = parseInt(emergency, 10);
        if (isNaN(icuVal) || icuVal < 0 || isNaN(emergencyVal) || emergencyVal < 0) {
            await showPopup('আইসিইউ ও জরুরি বেডের সংখ্যা সঠিক নয়।', 'error');
            return;
        }

        Object.assign(payload, {
            contactPerson,
            licenseNumber,
            icuAvailable: icuVal,
            emergencyBedAvailable: emergencyVal
        });
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = 'আবেদন জমা হচ্ছে...';
    submitBtn.disabled = true;

    try {
        const response = await fetch('/api/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        await showPopup(result.message, result.success ? 'success' : 'error');
        if (result.success) event.target.reset();
        updateTypeFields();
    } catch (error) {
        await showPopup('সার্ভারে কানেক্ট করা যাচ্ছে না।', 'error');
    } finally {
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
});

populateDivisions('appLocation');
