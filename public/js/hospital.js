// সিকিউরিটি ও ডেটা লোড
let userData = JSON.parse(localStorage.getItem('userData'));

if (localStorage.getItem('userRole') !== 'hospital' || !userData) {
    window.location.href = '/login';
    throw new Error('Unauthorized hospital dashboard access');
}

// হসপিটালের নাম নেভবারে দেখানো
document.getElementById('hospitalNameDisplay').innerText = `🏥 ${userData.name}`;

// Set form fields
document.getElementById('icuBeds').value = userData.icu_available ?? 0;
document.getElementById('emergencyBeds').value = userData.emergency_bed_available ?? 0;
document.getElementById('hPhone').value = userData.phone || '';
document.getElementById('hContactPerson').value = userData.contact_person || '';

// Parse location
let selectedDistrict = '';
let selectedUpazila = '';
if (userData.location) {
    if (userData.location.includes(', ')) {
        const parts = userData.location.split(', ');
        selectedUpazila = parts[0];
        selectedDistrict = parts[1];
    } else {
        selectedDistrict = userData.location;
    }
}

// Populate Bangladesh locations dropdowns
populateDivisions('hLocationName', selectedDistrict);
if (selectedDistrict) {
    populateUpazilas('hLocationName', 'hUpazila', selectedUpazila);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
}

function updateProfileDisplay() {
    document.getElementById('hospitalProfile').innerHTML = `
        <div><strong>ইমেইল:</strong><p class="text-slate-400 mt-0.5">${escapeHtml(userData.email || 'তথ্য নেই')}</p></div>
        <div><strong>ফোন নম্বর:</strong><p class="text-slate-400 mt-0.5">${escapeHtml(userData.phone || 'তথ্য নেই')}</p></div>
        <div><strong>দায়িত্বপ্রাপ্ত কর্মকর্তা:</strong><p class="text-slate-400 mt-0.5">${escapeHtml(userData.contact_person || 'তথ্য নেই')}</p></div>
        <div><strong>লাইসেন্স নম্বর:</strong><p class="text-slate-400 mt-0.5">${escapeHtml(userData.license_number || 'তথ্য নেই')}</p></div>
        <div><strong>ICU বেড সংখ্যা:</strong><p class="text-slate-400 mt-0.5 font-bold text-blue-400">${escapeHtml(userData.icu_available ?? 0)} টি</p></div>
        <div><strong>ইমার্জেন্সি বেড সংখ্যা:</strong><p class="text-slate-400 mt-0.5 font-bold text-emerald-400">${escapeHtml(userData.emergency_bed_available ?? 0)} টি</p></div>
        <div><strong>উপজেলা, জেলা:</strong><p class="text-slate-400 mt-0.5">${escapeHtml(userData.location || 'তথ্য নেই')}</p></div>
        <div><strong>পূর্ণ ঠিকানা:</strong><p class="text-slate-400 mt-0.5">${escapeHtml(userData.address || 'তথ্য নেই')}</p></div>
        <div class="sm:col-span-2"><strong>মানচিত্রের স্থানাঙ্ক:</strong><p class="text-slate-400 mt-0.5 font-mono">${escapeHtml(userData.latitude || 'N/A')}, ${escapeHtml(userData.longitude || 'N/A')}</p></div>
    `;
    updateApiKeyAndSnippetsDisplay();
}

// ── API Key and Code Snippet Management ──
let activeTab = 'curl';

function updateApiKeyAndSnippetsDisplay() {
    const keyInput = document.getElementById('apiKeyDisplay');
    const placeholders = document.querySelectorAll('.api-key-placeholder');
    
    const liveKey = userData.api_key || '';
    keyInput.value = liveKey;

    placeholders.forEach(el => {
        el.textContent = liveKey ? liveKey : 'YOUR_API_KEY';
    });

    // Update public endpoint full URL based on current host
    const host = window.location.origin;
    const endpointText = document.getElementById('endpointUrl');
    if (endpointText) {
        endpointText.textContent = `${host}/api/v1/hospital/update-beds`;
    }
}

window.toggleApiKeyVisibility = function() {
    const keyInput = document.getElementById('apiKeyDisplay');
    const eyeBtn = document.getElementById('eyeBtn');
    if (keyInput.type === 'password') {
        keyInput.type = 'text';
        eyeBtn.innerText = '🔒';
    } else {
        keyInput.type = 'password';
        eyeBtn.innerText = '👁️';
    }
};

window.copyApiKey = async function() {
    const liveKey = userData.api_key;
    if (!liveKey) {
        return showPopup('কোনো API Key পাওয়া যায়নি! দয়া করে নতুন কী জেনারেট করুন।', 'warning');
    }
    try {
        await navigator.clipboard.writeText(liveKey);
        showPopup('API Key ক্লিপবোর্ডে কপি করা হয়েছে!', 'success');
    } catch (err) {
        showPopup('কপি করতে ব্যর্থ হয়েছে!', 'error');
    }
};

window.regenerateApiKey = async function() {
    if (!confirm('আপনি কি নিশ্চিত যে নতুন API Key তৈরি করতে চান? আপনার আগের কী-টি সাথে সাথে নিষ্ক্রিয় হয়ে যাবে!')) return;
    
    try {
        const res = await fetch('/api/hospital/regenerate-api-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hospitalId: userData.id })
        });
        const result = await res.json();
        
        if (result.success && result.apiKey) {
            userData.api_key = result.apiKey;
            localStorage.setItem('userData', JSON.stringify(userData));
            updateApiKeyAndSnippetsDisplay();
            showPopup(result.message, 'success');
        } else {
            showPopup(result.message || 'API Key পুনর্স্থাপন করা যায়নি!', 'error');
        }
    } catch (err) {
        showPopup('সার্ভার এরর!', 'error');
    }
};

window.switchTab = function(lang) {
    activeTab = lang;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active', 'border-indigo-500', 'text-indigo-400');
        btn.classList.add('border-transparent', 'text-slate-400');
    });
    
    const activeBtn = document.getElementById(`tab-${lang}`);
    activeBtn.classList.add('active', 'border-indigo-500', 'text-indigo-400');
    activeBtn.classList.remove('border-transparent', 'text-slate-400');

    document.querySelectorAll('.code-block').forEach(block => {
        block.classList.add('hidden');
    });
    document.getElementById(`code-${lang}`).classList.remove('hidden');
};

window.copySnippet = async function() {
    const codeBlock = document.getElementById(`code-${activeTab}`);
    if (!codeBlock) return;
    
    // Replace current host and user key in copy if needed
    let text = codeBlock.textContent;
    const host = window.location.origin;
    text = text.replace(/http:\/\/localhost:3000/g, host);
    
    try {
        await navigator.clipboard.writeText(text);
        showPopup('ইন্টিগ্রেশন কোড ক্লিপবোর্ডে কপি করা হয়েছে!', 'success');
    } catch (err) {
        showPopup('কোড কপি করতে ব্যর্থ!', 'error');
    }
};

// Initial profiles
updateProfileDisplay();

function logout() {
    localStorage.clear();
    window.location.href = '/login';
}

// Map Integration
let selectedLocation = {
    latitude: parseFloat(userData.latitude) || 23.8103,
    longitude: parseFloat(userData.longitude) || 90.4125,
    address: userData.address || 'Dhaka, Bangladesh'
};

const selectedLocationText = document.getElementById('selectedLocationText');
const hLocationName = document.getElementById('hLocationName');

function setSelectedLocation({ latitude, longitude, address }) {
    selectedLocation = { latitude, longitude, address: address || `${latitude}, ${longitude}` };
    selectedLocationText.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-400 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>চিহ্নিত অবস্থান: <strong class="text-white">${escapeHtml(selectedLocation.address)}</strong> (${latitude.toFixed(5)}, ${longitude.toFixed(5)})</span>
    `;

    if (address && !['Current location', 'Manual map selection', 'Dragged map selection', 'Current device location'].includes(address)) {
        const lowerAddress = address.toLowerCase();
        let foundDiv = '';
        for (const div in bdLocations) {
            if (lowerAddress.includes(div.toLowerCase())) {
                foundDiv = div;
                break;
            }
        }
        
        if (foundDiv) {
            hLocationName.value = foundDiv;
            populateUpazilas('hLocationName', 'hUpazila');
            const upzSelect = document.getElementById('hUpazila');
            if (upzSelect) {
                let foundUpz = '';
                for (const upz of bdLocations[foundDiv]) {
                    if (lowerAddress.includes(upz.toLowerCase())) {
                        foundUpz = upz;
                        break;
                    }
                }
                if (foundUpz) {
                    upzSelect.value = foundUpz;
                }
            }
        }
    }
}

function initMap() {
    if (!window.google) return;

    const map = new google.maps.Map(document.getElementById('locationMap'), {
        center: { lat: selectedLocation.latitude, lng: selectedLocation.longitude },
        zoom: userData.latitude ? 14 : 11,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        styles: [
            { "elementType": "geometry", "stylers": [{ "color": "#1d2c4d" }] },
            { "elementType": "labels.text.fill", "stylers": [{ "color": "#8ec3b9" }] },
            { "elementType": "labels.text.stroke", "stylers": [{ "color": "#1a3646" }] },
            { "featureType": "administrative.country", "elementType": "geometry.stroke", "stylers": [{ "color": "#4b6878" }] },
            { "featureType": "administrative.province", "elementType": "geometry.stroke", "stylers": [{ "color": "#4b6878" }] },
            { "featureType": "landscape.man_made", "elementType": "geometry.stroke", "stylers": [{ "color": "#334e87" }] },
            { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#283d6a" }] },
            { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#6f9ba5" }] },
            { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#304a7d" }] },
            { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#98a5be" }] },
            { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#2c4575" }] },
            { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#0e1626" }] }
        ],
        restriction: { latLngBounds: { north: 26.8, south: 20.5, west: 87.9, east: 92.8 }, strictBounds: false }
    });

    const mapControls = document.getElementById('mapControls');
    const currentLocationControl = document.getElementById('currentLocationControl');
    mapControls.classList.remove('hidden');
    currentLocationControl.classList.remove('hidden');
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(mapControls);
    map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(currentLocationControl);

    const marker = new google.maps.Marker({ 
        position: { lat: selectedLocation.latitude, lng: selectedLocation.longitude }, 
        map: map, 
        draggable: true,
        animation: google.maps.Animation.DROP
    });

    function moveMarker(latLng, address) {
        marker.setPosition(latLng);
        map.panTo(latLng);
        map.setZoom(15);
        setSelectedLocation({ latitude: latLng.lat(), longitude: latLng.lng(), address });
    }

    map.addListener('click', (e) => {
        const latLng = e.latLng;
        new google.maps.Geocoder().geocode({ location: latLng }, (results, status) => {
            moveMarker(latLng, status === 'OK' && results[0] ? results[0].formatted_address : 'Manual map selection');
        });
    });

    marker.addListener('dragend', () => {
        const latLng = marker.getPosition();
        new google.maps.Geocoder().geocode({ location: latLng }, (results, status) => {
            setSelectedLocation({ latitude: latLng.lat(), longitude: latLng.lng(), address: status === 'OK' && results[0] ? results[0].formatted_address : 'Dragged map selection' });
        });
    });

    document.getElementById('useCurrentLocation').addEventListener('click', findMyLocation);
    document.getElementById('findLocationBtnInside')?.addEventListener('click', findMyLocation);

    function findMyLocation() {
        if (!navigator.geolocation) return showPopup('Location not supported.', 'warning');

        const btn = document.getElementById('findLocationBtnInside');
        const originalText = btn ? btn.innerText : '';
        if (btn) btn.innerText = 'খুঁজছে...';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const latLng = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
                new google.maps.Geocoder().geocode({ location: latLng }, (results, status) => {
                    moveMarker(latLng, status === 'OK' && results[0] ? results[0].formatted_address : 'Current location');
                    if (btn) btn.innerText = originalText;
                });
            },
            () => {
                showPopup('Location permission denied.', 'warning');
                if (btn) btn.innerText = originalText;
            },
            { enableHighAccuracy: true }
        );
    }

    if (['Current location', 'Manual map selection', 'Dragged map selection', 'Current device location'].includes(selectedLocation.address)) {
        new google.maps.Geocoder().geocode({ location: { lat: selectedLocation.latitude, lng: selectedLocation.longitude } }, (results, status) => {
            if (status === 'OK' && results[0]) setSelectedLocation({ latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, address: results[0].formatted_address });
        });
    }
    setSelectedLocation(selectedLocation);
}

// Load map
window.addEventListener('load', () => {
    if (window.google) initMap();
});

// Update Profile
document.getElementById('updateProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const upz = document.getElementById('hUpazila').value;
    const div = document.getElementById('hLocationName').value;
    const locVal = upz ? `${upz}, ${div}` : div;

    const icu = document.getElementById('icuBeds').value.trim();
    const emergency = document.getElementById('emergencyBeds').value.trim();
    const phone = document.getElementById('hPhone').value.trim();
    const contactPerson = document.getElementById('hContactPerson').value.trim();

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('880')) {
        cleanPhone = cleanPhone.substring(2);
    }
    const bdRegex = /^01[3-9]\d{8}$/;
    if (!bdRegex.test(cleanPhone)) {
        await showPopup('একটি সঠিক বাংলাদেশী মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)।', 'error');
        return;
    }

    const nameRegex = /^[\u0980-\u09FFa-zA-Z\s.-]{2,50}$/;
    if (!nameRegex.test(contactPerson)) {
        await showPopup('যোগাযোগের ব্যক্তির নাম সঠিক নয় (২-৫০ অক্ষরের মধ্যে, শুধু অক্ষর, ডট বা স্পেস)।', 'error');
        return;
    }

    const icuVal = parseInt(icu, 10);
    const emergencyVal = parseInt(emergency, 10);
    if (isNaN(icuVal) || icuVal < 0 || isNaN(emergencyVal) || emergencyVal < 0) {
        await showPopup('আইসিইউ ও জরুরি বেডের সংখ্যা সঠিক নয় (অবশ্যই ০ বা তার বেশি হতে হবে)।', 'error');
        return;
    }

    document.getElementById('hPhone').value = cleanPhone;

    const payload = {
        hospitalId: userData.id,
        icuAvailable: icuVal,
        emergencyBedAvailable: emergencyVal,
        phone: cleanPhone,
        contactPerson: contactPerson,
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
        const res = await fetch('/api/hospital/update-profile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const result = await res.json();
        await showPopup(result.message, result.success ? 'success' : 'error');

        if (result.success && result.hospitalData) {
            userData = result.hospitalData;
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
