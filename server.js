require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialize Firebase Admin
try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
    console.log('Firebase admin not fully configured yet, push notifications may not work:', error.message);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // ফ্রন্টএন্ড ফাইল সার্ভ করার জন্য

const ALLOWED_BLOOD_GROUPS = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-', 'AB-'];
const ALLOWED_DONOR_STATUSES = ['Available', 'Busy'];
const ALLOWED_USER_TABLES = ['donors', 'hospitals', 'doctors'];
const ALLOWED_APPLICATION_TYPES = ['donor', 'hospital'];
const ALLOWED_APPLICATION_STATUSES = ['Pending', 'Approved', 'Rejected'];
const REQUEST_EXPIRY_MINUTES = 5;

function normalizeText(value) {
    return String(value || '').trim();
}

function isNonNegativeInteger(value) {
    return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function validateAndNormalizeBDPhone(phone) {
    if (typeof phone !== 'string') return null;
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('880')) {
        clean = clean.substring(2);
    }
    const bdRegex = /^01[3-9]\d{8}$/;
    return bdRegex.test(clean) ? clean : null;
}

function validateEmail(email) {
    if (typeof email !== 'string') return false;
    const clean = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(clean);
}

function validateName(name) {
    if (typeof name !== 'string') return false;
    const clean = name.trim();
    const nameRegex = /^[\u0980-\u09FFa-zA-Z\s.-]{2,50}$/;
    return nameRegex.test(clean);
}

function validateCoordinates(lat, lng) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
           Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function toNullableText(value) {
    const text = normalizeText(value);
    return text || null;
}

function toNullableNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toRequiredCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function extractDistrict(location) {
    const parts = normalizeText(location).split(',').map(part => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

function extractUpazila(location) {
    const parts = normalizeText(location).split(',').map(part => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts[0] : '';
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildRequestTrackingUrl(req, trackingToken) {
    return `${req.protocol}://${req.get('host')}/request-status?token=${encodeURIComponent(trackingToken)}`;
}

function buildDonorPublicRow(row) {
    let responseStatus = row.response_status;
    // Queued = assigned but not yet notified
    if (row.response_status === 'Pending' && !row.notified_at) responseStatus = 'Queued';
    // No Response = notified but timer expired without response
    if (row.response_status === 'Pending' && row.notified_at && Number(row.is_donor_expired) === 1) responseStatus = 'No Response';
    return {
        notifyOrder: row.notify_order,
        name: row.name,
        location: row.location,
        donorLiveStatus: row.donor_live_status,
        responseStatus,
        distanceKm: row.distance_km,
        notifiedAt: row.notified_at,
        respondedAt: row.responded_at,
        isActive: responseStatus === 'Pending',
        remainingSeconds: row.remaining_seconds == null ? null : Number(row.remaining_seconds),
        phone: row.response_status === 'Accepted' ? row.phone : null
    };
}

function buildQueueState(request, donors) {
    // ✅ Completed — someone accepted
    if (request.status === 'Completed' || donors.some(d => d.responseStatus === 'Accepted')) {
        const acceptedDonor = donors.find(d => d.responseStatus === 'Accepted');
        return {
            status: 'completed',
            label: '✅ সম্পন্ন',
            message: acceptedDonor
                ? `${acceptedDonor.name} রক্তদানে রাজি হয়েছেন। রোগীর পরিবারকে যোগাযোগ করুন।`
                : 'একজন ডোনার request accept করেছেন।'
        };
    }

    // 🔴 Active — request sent to one donor, waiting for response
    const activeDonor = donors.find(d => d.responseStatus === 'Pending');
    if (activeDonor) {
        const dist = activeDonor.distanceKm != null ? ` (${Number(activeDonor.distanceKm).toFixed(1)} km দূরে)` : '';
        return {
            status: 'active',
            label: '🔴 Active',
            message: `${activeDonor.name}${dist} — এর কাছে request গেছে। সাড়া না দিলে বা reject করলে system পরবর্তী নিকটতম donor-এ যাবে।`
        };
    }

    // ⏳ Queued — more donors waiting in line
    const queuedCount = donors.filter(d => d.responseStatus === 'Queued').length;
    if (queuedCount > 0) {
        return {
            status: 'queued',
            label: '⏳ Queue-এ আছে',
            message: `${queuedCount} জন donor queue-তে আছেন। System এখনই পরবর্তী জনকে activate করছে।`
        };
    }

    // ❌ Exhausted — all donors in district contacted, none available
    return {
        status: 'exhausted',
        label: '❌ Donor পাওয়া যায়নি',
        message: `${request.district || request.location} জেলার সকল Available ${request.blood_group} donor-কে request পাঠানো হয়েছে। এই মুহূর্তে আর কোনো donor নেই। নতুন request দিন বা পরে চেষ্টা করুন।`
    };
}

function dbQuery(query, values = []) {
    return new Promise((resolve, reject) => {
        db.query(query, values, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

const _activateLocks = new Set();

async function sendRequestToDonor(donor, request) {
    // Even without FCM token, the donor will see it when they open the app
    // (it appears in their pending-requests list)
    if (!donor.fcm_token) {
        console.log(`[warn] No FCM token for ${donor.name} — will appear in-app when they login.`);
        return false;
    }
    if (admin.apps.length === 0) {
        console.log(`[warn] Firebase not configured — notification skipped for ${donor.name}.`);
        return false;
    }

    const message = {
        notification: {
            title: `🚨 জরুরি রক্তের প্রয়োজন! ${request.blood_group}`,
            body: `🏥 ${request.hospital_name} | 📍 ${request.location} | ⏰ ${request.needed_time}`,
        },
        data: {
            requestId: String(request.id),
            trackingToken: String(request.tracking_token || ''),
            bloodGroup: request.blood_group,
            hospitalName: request.hospital_name,
            location: request.location,
            neededTime: request.needed_time,
            patientDisease: request.patient_disease || '',
            contactNumber: request.contact_number
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'lifeline_emergency',
                sound: 'default',
                priority: 'high',
                defaultSound: true,
                defaultVibrateTimings: true,
            }
        },
        apns: {
            payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } }
        },
        token: donor.fcm_token,
    };

    try {
        await admin.messaging().send(message);
        console.log(`[ok] Push sent to: ${donor.name}`);
        return true;
    } catch (error) {
        console.error(`[err] Push failed for ${donor.name}:`, error.message);
        // If token is invalid/expired, clear it
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
            await dbQuery('UPDATE donors SET fcm_token = NULL WHERE id = ?', [donor.id]).catch(() => {});
            console.log(`[info] Cleared invalid FCM token for ${donor.name}`);
        }
        return false;
    }
}

// Find available donors in district, sorted by distance
async function findAvailableDonorsInDistrict(request, excludeDonorIds = []) {
    const district = normalizeText(request.district) || extractDistrict(request.location);
    const requestLat = Number(request.latitude);
    const requestLng = Number(request.longitude);
    const excluded = new Set(excludeDonorIds.map(id => Number(id)));

    const rows = await dbQuery(
        `SELECT id, name, phone, location, address, latitude, longitude, fcm_token
         FROM donors
         WHERE blood_group = ? AND status = 'Available'
           AND (last_donation_date IS NULL OR last_donation_date <= DATE_SUB(CURDATE(), INTERVAL 3 MONTH))`,
        [request.blood_group]
    );

    return rows
        .filter(donor => {
            if (excluded.has(Number(donor.id))) return false;
            const donorDistrict = extractDistrict(donor.location);
            return donorDistrict && donorDistrict.toLowerCase() === district.toLowerCase();
        })
        .map(donor => {
            const donorLat = Number(donor.latitude);
            const donorLng = Number(donor.longitude);
            const hasCoords = Number.isFinite(requestLat) && Number.isFinite(requestLng)
                && Number.isFinite(donorLat) && Number.isFinite(donorLng);
            return { ...donor, distance_km: hasCoords ? haversineKm(requestLat, requestLng, donorLat, donorLng) : null };
        })
        .sort((a, b) => {
            if (a.distance_km === null && b.distance_km === null) return a.id - b.id;
            if (a.distance_km === null) return 1;
            if (b.distance_km === null) return -1;
            return a.distance_km - b.distance_km;
        });
}

// Activate next queued donor for a blood request
async function activateNextDonor(requestId) {
    if (_activateLocks.has(requestId)) {
        console.log(`[skip] Request #${requestId}: activateNextDonor already running — skipping duplicate call.`);
        return { activated: false, reason: 'locked' };
    }
    _activateLocks.add(requestId);

    try {
        const requests = await dbQuery('SELECT * FROM blood_requests WHERE id = ? LIMIT 1', [requestId]);
        if (requests.length === 0) return { activated: false, reason: 'not_found' };

        const request = requests[0];
        if (request.status !== 'Pending') return { activated: false, reason: 'not_pending' };

        // Check if already accepted → mark Completed
        const acceptedRows = await dbQuery(
            'SELECT id FROM donor_requests WHERE request_id = ? AND status = "Accepted" LIMIT 1',
            [requestId]
        );
        if (acceptedRows.length > 0) {
            await dbQuery('UPDATE blood_requests SET status = "Completed" WHERE id = ?', [requestId]);
            return { activated: false, reason: 'completed' };
        }

        // Check if there's a currently active (unexpired) donor notification
        const activeRows = await dbQuery(`
            SELECT dr.id, dr.notified_at
            FROM donor_requests dr
            WHERE dr.request_id = ?
              AND dr.status = 'Pending'
              AND dr.notified_at IS NOT NULL
              AND DATE_ADD(dr.notified_at, INTERVAL ? MINUTE) > NOW()
            ORDER BY dr.notify_order ASC
            LIMIT 1
        `, [requestId, REQUEST_EXPIRY_MINUTES]);

        if (activeRows.length > 0) {
            await dbQuery(
                'UPDATE blood_requests SET expires_at = DATE_ADD(?, INTERVAL ? MINUTE) WHERE id = ?',
                [activeRows[0].notified_at, REQUEST_EXPIRY_MINUTES, requestId]
            );
            return { activated: false, reason: 'waiting' };
        }

        // Pick next queued donor who is still Available (never notified yet)
        const nextRows = await dbQuery(`
            SELECT
                dr.id AS donor_request_id,
                d.id, d.name, d.phone, d.location, d.fcm_token
            FROM donor_requests dr
            JOIN donors d ON dr.donor_id = d.id
            WHERE dr.request_id = ?
              AND dr.status = 'Pending'
              AND dr.notified_at IS NULL
              AND d.status = 'Available'
            ORDER BY dr.notify_order ASC, dr.id ASC
            LIMIT 1
        `, [requestId]);

        if (nextRows.length === 0) {
            console.log(`[info] Request #${requestId}: Queue exhausted. All district donors have been contacted.`);
            return { activated: false, reason: 'exhausted' };
        }

        const donor = nextRows[0];
        await dbQuery('UPDATE donor_requests SET notified_at = NOW() WHERE id = ?', [donor.donor_request_id]);
        await dbQuery('UPDATE blood_requests SET expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
            [REQUEST_EXPIRY_MINUTES, requestId]);
        await sendRequestToDonor(donor, request);
        console.log(`[ok] Request #${requestId}: Activated donor ${donor.name} (#${donor.id}) — nearest first`);
        return { activated: true, donor };
    } finally {
        _activateLocks.delete(requestId);
    }
}


function runSchemaQuery(query) {
    db.query(query, (err) => {
        if (err && err.code !== 'ER_DUP_FIELDNAME') {
            console.error('Schema update warning:', err.message);
        }
    });
}

function setupSchema() {
    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS applications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            type ENUM('donor', 'hospital') NOT NULL,
            name VARCHAR(150) NOT NULL,
            email VARCHAR(150) NOT NULL,
            password VARCHAR(255) NOT NULL,
            phone VARCHAR(30) NOT NULL,
            location VARCHAR(150) NOT NULL,
            address VARCHAR(255) NULL,
            latitude DECIMAL(10, 7) NULL,
            longitude DECIMAL(10, 7) NULL,
            blood_group ENUM('A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-', 'AB-') NULL,
            profession VARCHAR(120) NULL,
            donation_count INT NULL,
            last_donation_date DATE NULL,
            age INT NULL,
            health_notes TEXT NULL,
            contact_person VARCHAR(150) NULL,
            license_number VARCHAR(120) NULL,
            icu_available INT NOT NULL DEFAULT 0,
            emergency_bed_available INT NOT NULL DEFAULT 0,
            status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
            review_message TEXT NULL,
            reviewed_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_pending_email_type (type, email, status)
        )
    `);

    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS blood_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            blood_group ENUM('A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-', 'AB-') NOT NULL,
            location VARCHAR(150) NOT NULL,
            district VARCHAR(100) NULL,
            upazila VARCHAR(100) NULL,
            latitude DECIMAL(10, 7) NULL,
            longitude DECIMAL(10, 7) NULL,
            hospital_name VARCHAR(255) NOT NULL,
            needed_time VARCHAR(150) NOT NULL,
            patient_disease VARCHAR(255) NOT NULL,
            contact_number VARCHAR(30) NOT NULL,
            tracking_token VARCHAR(80) NULL UNIQUE,
            expires_at DATETIME NULL,
            status ENUM('Pending', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Pending',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS donor_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            request_id INT NOT NULL,
            donor_id INT NOT NULL,
            status ENUM('Pending', 'Accepted', 'Rejected') NOT NULL DEFAULT 'Pending',
            notify_order INT NULL,
            distance_km DECIMAL(8, 2) NULL,
            notified_at TIMESTAMP NULL,
            responded_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (request_id) REFERENCES blood_requests(id) ON DELETE CASCADE,
            FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE CASCADE
        )
    `);

    [
        "ALTER TABLE donors ADD COLUMN email VARCHAR(150) NULL AFTER name",
        "ALTER TABLE donors ADD COLUMN profession VARCHAR(120) NULL AFTER phone",
        "ALTER TABLE donors ADD COLUMN donation_count INT NOT NULL DEFAULT 0 AFTER profession",
        "ALTER TABLE donors ADD COLUMN last_donation_date DATE NULL AFTER donation_count",
        "ALTER TABLE donors ADD COLUMN age INT NULL AFTER last_donation_date",
        "ALTER TABLE donors ADD COLUMN health_notes TEXT NULL AFTER age",
        "ALTER TABLE donors ADD COLUMN address VARCHAR(255) NULL AFTER location",
        "ALTER TABLE donors ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER address",
        "ALTER TABLE donors ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude",
        "ALTER TABLE hospitals ADD COLUMN email VARCHAR(150) NULL AFTER name",
        "ALTER TABLE hospitals ADD COLUMN phone VARCHAR(30) NULL AFTER location",
        "ALTER TABLE hospitals ADD COLUMN address VARCHAR(255) NULL AFTER phone",
        "ALTER TABLE hospitals ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER address",
        "ALTER TABLE hospitals ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude",
        "ALTER TABLE hospitals ADD COLUMN contact_person VARCHAR(150) NULL AFTER longitude",
        "ALTER TABLE hospitals ADD COLUMN license_number VARCHAR(120) NULL AFTER contact_person",
        "ALTER TABLE hospitals ADD COLUMN api_key VARCHAR(64) NULL UNIQUE AFTER license_number",
        "ALTER TABLE blood_requests ADD COLUMN contact_number VARCHAR(30) NOT NULL AFTER patient_disease",
        "ALTER TABLE blood_requests ADD COLUMN district VARCHAR(100) NULL AFTER location",
        "ALTER TABLE blood_requests ADD COLUMN upazila VARCHAR(100) NULL AFTER district",
        "ALTER TABLE blood_requests ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER upazila",
        "ALTER TABLE blood_requests ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude",
        "ALTER TABLE blood_requests ADD COLUMN tracking_token VARCHAR(80) NULL UNIQUE AFTER contact_number",
        "ALTER TABLE blood_requests ADD COLUMN expires_at DATETIME NULL AFTER tracking_token",
        "ALTER TABLE donor_requests ADD COLUMN notify_order INT NULL AFTER status",
        "ALTER TABLE donor_requests ADD COLUMN distance_km DECIMAL(8, 2) NULL AFTER notify_order",
        "ALTER TABLE donor_requests ADD COLUMN notified_at TIMESTAMP NULL AFTER distance_km",
        "ALTER TABLE donor_requests ADD COLUMN responded_at TIMESTAMP NULL AFTER notified_at",
        "ALTER TABLE donors ADD COLUMN fcm_token VARCHAR(255) NULL AFTER password",
        "ALTER TABLE doctors ADD COLUMN treated_diseases TEXT NULL AFTER specialties",
        "ALTER TABLE doctor_chambers ADD COLUMN max_patients INT NOT NULL DEFAULT 30 AFTER time_per_patient_min",
        "ALTER TABLE doctor_chambers ADD COLUMN booking_status ENUM('Available', 'Full') NOT NULL DEFAULT 'Available' AFTER max_patients",
        "ALTER TABLE hospitals ADD COLUMN normal_bed_available INT NOT NULL DEFAULT 0 AFTER emergency_bed_available",
        "ALTER TABLE hospitals ADD COLUMN icu_total INT NOT NULL DEFAULT 0 AFTER normal_bed_available",
        "ALTER TABLE hospitals ADD COLUMN em_total INT NOT NULL DEFAULT 0 AFTER icu_total",
        "ALTER TABLE hospitals ADD COLUMN normal_total INT NOT NULL DEFAULT 0 AFTER em_total",
        "ALTER TABLE doctors ADD COLUMN hospital_id INT NULL AFTER id",
        "ALTER TABLE doctors ADD COLUMN max_patients INT NULL AFTER treated_diseases",
        "ALTER TABLE doctors ADD COLUMN visiting_days VARCHAR(255) NULL AFTER max_patients",
        "ALTER TABLE doctor_appointments ADD COLUMN appointment_type ENUM('online','offline') NOT NULL DEFAULT 'online' AFTER status"
    ].forEach(runSchemaQuery);


    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS doctors (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            email VARCHAR(150) NULL,
            phone VARCHAR(30) NOT NULL,
            district VARCHAR(100) NOT NULL,
            specialties VARCHAR(255) NOT NULL,
            treated_diseases TEXT NULL,
            designation VARCHAR(255) NULL,
            experience_years INT NULL,
            fee DECIMAL(10,2) NOT NULL DEFAULT 100.00,
            username VARCHAR(150) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS doctor_chambers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_id INT NOT NULL,
            clinic_name VARCHAR(255) NOT NULL,
            location VARCHAR(255) NOT NULL,
            visiting_days VARCHAR(255) NOT NULL,
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            time_per_patient_min INT NOT NULL DEFAULT 15,
            max_patients INT NOT NULL DEFAULT 30,
            booking_status ENUM('Available', 'Full') NOT NULL DEFAULT 'Available',
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
        )
    `);

    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS doctor_leaves (
            id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_id INT NOT NULL,
            leave_date DATE NOT NULL,
            reason VARCHAR(255) NULL,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
            UNIQUE KEY unique_leave (doctor_id, leave_date)
        )
    `);

    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS chamber_date_overrides (
            id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_id INT NOT NULL,
            chamber_id INT NOT NULL,
            override_date DATE NOT NULL,
            max_patients INT NULL,
            booking_status ENUM('Available', 'Full') NOT NULL DEFAULT 'Available',
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
            FOREIGN KEY (chamber_id) REFERENCES doctor_chambers(id) ON DELETE CASCADE,
            UNIQUE KEY unique_override (chamber_id, override_date)
        )
    `);

    runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS doctor_appointments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_id INT NOT NULL,
            chamber_id INT NOT NULL,
            patient_name VARCHAR(150) NOT NULL,
            patient_phone VARCHAR(30) NOT NULL,
            patient_email VARCHAR(150) NULL,
            patient_age INT NOT NULL,
            patient_gender ENUM('Male', 'Female', 'Other') NOT NULL,
            patient_problem TEXT NOT NULL,
            appointment_date DATE NOT NULL,
            appointment_time TIME NOT NULL,
            reporting_time TIME NOT NULL,
            serial_number INT NOT NULL,
            payment_method VARCHAR(50) NOT NULL,
            trx_id VARCHAR(100) NOT NULL,
            payment_amount DECIMAL(10,2) NOT NULL DEFAULT 100.00,
            status ENUM('Pending', 'Confirmed', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Confirmed',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
            FOREIGN KEY (chamber_id) REFERENCES doctor_chambers(id) ON DELETE CASCADE
        )
    `);
}

// --- Database Connection ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

db.query('SELECT 1', (err) => {
    if (err) {
        console.log('MySQL connection failed.', err.message);
    } else {
        console.log('MySQL connected.');
        setupSchema();
    }
});

// --- Push Notification Init ---
// Firebase Admin SDK initialized at the top.
// WhatsApp logic has been removed as requested.



// --- Core Emergency & Public APIs ---

// --- [পাবলিক] ইমার্জেন্সি রিকোয়েস্ট এবং অটোমেশন API ---
/**
 * POST /api/emergency
 * Smart serial matching:
 * 1. Scan ALL Available donors in same district, sort by distance
 * 2. Save ALL of them to donor_requests queue (sorted nearest→farthest)
 * 3. Immediately activate (notify) the nearest one
 * 4. Even if 0 donors found, still create the blood_request + tracking link
 */
app.post('/api/emergency', (req, res) => {
    const bloodGroup = normalizeText(req.body.bloodGroup);
    const location = normalizeText(req.body.location);
    const district = normalizeText(req.body.district) || extractDistrict(location);
    const upazila = normalizeText(req.body.upazila) || extractUpazila(location);
    const latitude = toRequiredCoordinate(req.body.latitude);
    const longitude = toRequiredCoordinate(req.body.longitude);
    const hospitalName = normalizeText(req.body.hospitalName);
    const neededTime = normalizeText(req.body.neededTime);
    const patientDisease = normalizeText(req.body.patientDisease);
    const contactNumber = normalizeText(req.body.contactNumber);

    const cleanPhone = validateAndNormalizeBDPhone(contactNumber);
    if (!cleanPhone) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।' });
    }

    if (!ALLOWED_BLOOD_GROUPS.includes(bloodGroup) || !location || !district || !validateCoordinates(latitude, longitude) || !hospitalName || !neededTime || !patientDisease) {
        return res.status(400).json({ success: false, message: 'সবগুলো তথ্য সঠিকভাবে পূরণ করুন।' });
    }

    const requestSeed = {
        blood_group: bloodGroup,
        location,
        district,
        latitude,
        longitude
    };

    findAvailableDonorsInDistrict(requestSeed)
        .then((sortedDonors) => {
            if (sortedDonors.length > 0) {
                console.log(`[ok] ${sortedDonors.length} ${bloodGroup} Available donor found in ${district}. Building queue...`);
            } else {
                console.log(`[info] ${district}: no Available ${bloodGroup} donors right now.`);
            }

            // Save blood request to DB first
            const trackingToken = crypto.randomBytes(24).toString('hex');
            const insertRequestQuery = `
                INSERT INTO blood_requests (
                    blood_group, location, district, upazila, latitude, longitude,
                    hospital_name, needed_time, patient_disease, contact_number,
                    tracking_token
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            db.query(insertRequestQuery, [
                bloodGroup, location, district, upazila || null, latitude, longitude,
                hospitalName, neededTime, patientDisease, cleanPhone,
                trackingToken
            ], async (insertErr, result) => {
                if (insertErr) return res.status(500).json({ success: false, message: 'রিকোয়েস্ট সেভ করতে সমস্যা হয়েছে।' });
                
                const requestId = result.insertId;

                try {
                    for (let index = 0; index < sortedDonors.length; index++) {
                        const donor = sortedDonors[index];
                        const notifyOrder = index + 1;
                        const distanceKm = donor.distance_km === null ? null : Number(donor.distance_km.toFixed(2));

                        await dbQuery(`
                            INSERT INTO donor_requests (request_id, donor_id, notify_order, distance_km, notified_at)
                            VALUES (?, ?, ?, ?, NULL)
                        `, [requestId, donor.id, notifyOrder, distanceKm]);
                    }

                    await activateNextDonor(requestId);
                } catch (queueErr) {
                    console.error('Error preparing serial donor queue:', queueErr.message);
                    return res.status(500).json({ success: false, message: 'ডোনার queue তৈরি করতে সমস্যা হয়েছে।' });
                }

                res.json({
                    success: true,
                    message: sortedDonors.length > 0
                        ? `${sortedDonors.length} জন available ডোনার queue করা হয়েছে। সবচেয়ে কাছের ডোনারের কাছে আগে পাঠানো হয়েছে।`
                        : 'এই মুহূর্তে Available donor নেই। tracking page থেকে system search চালিয়ে যাবে।',
                    requestId,
                    trackingToken,
                    trackingUrl: buildRequestTrackingUrl(req, trackingToken),
                    donorCount: sortedDonors.length,
                    notificationCount: sortedDonors.length > 0 ? 1 : 0,
                    expiresInMinutes: REQUEST_EXPIRY_MINUTES
                });
            });
        })
        .catch((err) => {
            console.error('Emergency donor search failed:', err.message);
            res.status(500).json({ success: false, message: 'সার্ভারে সমস্যা হয়েছে।' });
        });
});

// --- [পাবলিক] রিকোয়েস্ট ট্র্যাকিং স্ট্যাটাস ---
app.get('/api/request-status', async (req, res) => {
    const token = normalizeText(req.query.token);
    if (!token || token.length < 20) {
        return res.status(400).json({ success: false, message: 'ট্র্যাকিং লিংকটি সঠিক নয়।' });
    }

    try {
        const requestForQueue = await dbQuery('SELECT id FROM blood_requests WHERE tracking_token = ? LIMIT 1', [token]);
        if (requestForQueue.length > 0) {
            await activateNextDonor(requestForQueue[0].id);
        }
    } catch (queueErr) {
        console.error('Serial queue refresh failed:', queueErr.message);
    }

    const requestQuery = `
        SELECT
            id, blood_group, location, district, upazila, latitude, longitude,
            hospital_name, needed_time, patient_disease, contact_number,
            status, created_at, expires_at,
            GREATEST(TIMESTAMPDIFF(SECOND, NOW(), expires_at), 0) AS remaining_seconds,
            CASE WHEN expires_at IS NOT NULL AND expires_at <= NOW() THEN 1 ELSE 0 END AS is_expired
        FROM blood_requests
        WHERE tracking_token = ?
        LIMIT 1
    `;

    db.query(requestQuery, [token], (err, requestResults) => {
        if (err) return res.status(500).json({ success: false, message: 'স্ট্যাটাস লোড করতে সমস্যা হয়েছে।' });
        if (requestResults.length === 0) {
            return res.status(404).json({ success: false, message: 'এই ট্র্যাকিং লিংকের কোনো রিকোয়েস্ট পাওয়া যায়নি।' });
        }

        const request = requestResults[0];
        const donorQuery = `
            SELECT
                dr.notify_order, dr.status AS response_status, dr.distance_km,
                dr.notified_at, dr.responded_at,
                CASE
                    WHEN dr.notified_at IS NOT NULL
                     AND DATE_ADD(dr.notified_at, INTERVAL ? MINUTE) <= NOW()
                    THEN 1 ELSE 0
                END AS is_donor_expired,
                CASE
                    WHEN dr.notified_at IS NULL THEN NULL
                    ELSE GREATEST(TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(dr.notified_at, INTERVAL ? MINUTE)), 0)
                END AS remaining_seconds,
                d.name, d.phone, d.location, d.status AS donor_live_status
            FROM donor_requests dr
            JOIN donors d ON dr.donor_id = d.id
            WHERE dr.request_id = ?
            ORDER BY dr.notify_order ASC, dr.id ASC
        `;

        db.query(donorQuery, [REQUEST_EXPIRY_MINUTES, REQUEST_EXPIRY_MINUTES, request.id], (donorErr, donorResults) => {
            if (donorErr) return res.status(500).json({ success: false, message: 'ডোনার স্ট্যাটাস লোড করতে সমস্যা হয়েছে।' });

            const donors = donorResults.map(row => buildDonorPublicRow(row));
            const summary = donors.reduce((acc, donor) => {
                acc.total += 1;
                if (donor.responseStatus === 'Accepted') acc.accepted += 1;
                else if (donor.responseStatus === 'Rejected') acc.rejected += 1;
                else if (donor.responseStatus === 'No Response') acc.noResponse += 1;
                else if (donor.responseStatus === 'Queued') acc.queued += 1;
                else acc.pending += 1;
                return acc;
            }, { total: 0, accepted: 0, rejected: 0, pending: 0, queued: 0, noResponse: 0 });
            const queueState = buildQueueState(request, donors);

            res.json({
                success: true,
                data: {
                    request: {
                        id: request.id,
                        bloodGroup: request.blood_group,
                        location: request.location,
                        district: request.district,
                        upazila: request.upazila,
                        latitude: request.latitude,
                        longitude: request.longitude,
                        hospitalName: request.hospital_name,
                        neededTime: request.needed_time,
                        patientDisease: request.patient_disease,
                        contactNumber: request.contact_number,
                        status: request.status,
                        createdAt: request.created_at,
                        expiresAt: request.expires_at,
                        remainingSeconds: Number(request.remaining_seconds || 0),
                        isExpired: queueState.status === 'exhausted'
                    },
                    summary,
                    queueState,
                    donors
                }
            });
        });
    });
});

// --- [পাবলিক] ওয়েবসাইটের হোমপেজে লাইভ হসপিটাল সিট দেখার API ---
app.get('/api/hospitals', (req, res) => {
    const query = "SELECT id, name, location, phone, address, latitude, longitude, icu_available, emergency_bed_available FROM hospitals WHERE status = 'Active'";
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'ডেটা লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

// --- [পাবলিক] ওয়েবসাইটের ম্যাপে ডোনারদের অবস্থান দেখার API ---
app.get('/api/donors', (req, res) => {
    const query = "SELECT id, name, blood_group, location, latitude, longitude FROM donors WHERE status = 'Available' AND latitude IS NOT NULL AND longitude IS NOT NULL";
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'ডেটা লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

// --- [পাবলিক] হোমপেজের জন্য লাইভ পরিসংখ্যান (Stats) API ---
// --- Clean URL Routes ---

const path = require('path');
const publicDir = path.join(__dirname, 'public');

// Map of clean URL slug -> HTML filename
const cleanUrlMap = {
    'donor-panel':       'donor-dashboard.html',
    'hospital-panel':    'hospital-dashboard.html',
    'dr-panel':          'doctor-dashboard.html',
    'root-panel':        'system-root.html',
    'admin-panel':       'master-dashboard.html',
    'login':             'login.html',
    'apply':             'login.html',
    'doctors':           'doctors.html',
    'medical-centers':   'medical-centers.html',
    'blood-request':     'blood-request.html',
    'request-status':    'request-status.html',
    'hospital-beds':     'hospital-beds.html',
    'prescription':      'prescription.html',
};

Object.entries(cleanUrlMap).forEach(([slug, file]) => {
    app.get(`/${slug}`, (req, res) => {
        res.sendFile(path.join(publicDir, file));
    });
    // Also support /slug?query=string by keeping query strings intact via sendFile
});


app.get('/api/stats', async (req, res) => {
    try {
        const donorsRes = await dbQuery("SELECT COUNT(*) AS count FROM donors");
        const hospitalsRes = await dbQuery("SELECT COUNT(*) AS count FROM hospitals WHERE status = 'Active'");
        const alertsRes = await dbQuery("SELECT COUNT(*) AS count FROM donor_requests");
        
        res.json({
            success: true,
            donors: donorsRes[0].count,
            hospitals: hospitalsRes[0].count,
            alerts: alertsRes[0].count
        });
    } catch (err) {
        console.error('Stats fetch error:', err.message);
        res.status(500).json({ success: false, message: 'পরিসংখ্যান লোড করতে সমস্যা হয়েছে।' });
    }
});

app.post('/api/applications', (req, res) => {
    const type = normalizeText(req.body.type);
    const name = normalizeText(req.body.name);
    const email = normalizeText(req.body.email).toLowerCase();
    const password = normalizeText(req.body.password);
    const phone = normalizeText(req.body.phone);
    const location = normalizeText(req.body.location);
    const address = toNullableText(req.body.address);
    const latitude = toNullableNumber(req.body.latitude);
    const longitude = toNullableNumber(req.body.longitude);
    const bloodGroup = toNullableText(req.body.bloodGroup);
    const profession = toNullableText(req.body.profession);
    const donationCount = req.body.donationCount === '' || req.body.donationCount == null ? null : Number(req.body.donationCount);
    const lastDonationDate = toNullableText(req.body.lastDonationDate);
    const age = req.body.age === '' || req.body.age == null ? null : Number(req.body.age);
    const healthNotes = toNullableText(req.body.healthNotes);
    const contactPerson = toNullableText(req.body.contactPerson);
    const licenseNumber = toNullableText(req.body.licenseNumber);
    const icuAvailable = req.body.icuAvailable === '' || req.body.icuAvailable == null ? 0 : Number(req.body.icuAvailable);
    const emergencyBedAvailable = req.body.emergencyBedAvailable === '' || req.body.emergencyBedAvailable == null ? 0 : Number(req.body.emergencyBedAvailable);

    if (!ALLOWED_APPLICATION_TYPES.includes(type) || !name || !email || !password || !phone || !location) {
        return res.status(400).json({ success: false, message: 'আবেদনের মূল তথ্যগুলো পূরণ করুন।' });
    }

    const cleanPhone = validateAndNormalizeBDPhone(phone);
    if (!cleanPhone) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।' });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক ইমেইল এড্রেস দিন।' });
    }

    if (!validateName(name)) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক নাম দিন (২-৫০ অক্ষরের মধ্যে, শুধু অক্ষর, ডট বা স্পেস)।' });
    }

    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }

    if (latitude !== null && longitude !== null && !validateCoordinates(latitude, longitude)) {
        return res.status(400).json({ success: false, message: 'অবস্থানের অক্ষাংশ ও দ্রাঘিমাংশ সঠিক নয়।' });
    }

    if (type === 'donor') {
        if (!ALLOWED_BLOOD_GROUPS.includes(bloodGroup) || !profession || profession.trim().length < 2 || !Number.isInteger(donationCount) || donationCount < 0) {
            return res.status(400).json({ success: false, message: 'ডোনারের রক্তের গ্রুপ, পেশা ও রক্তদানের সংখ্যা সঠিকভাবে দিন।' });
        }
        if (age === null || !Number.isInteger(age) || age < 18 || age > 80) {
            return res.status(400).json({ success: false, message: 'ডোনারের বয়স ১৮ থেকে ৮০ এর মধ্যে দিন।' });
        }
    }

    if (type === 'hospital') {
        if (!contactPerson || !validateName(contactPerson) || !licenseNumber || !isNonNegativeInteger(icuAvailable) || !isNonNegativeInteger(emergencyBedAvailable)) {
            return res.status(400).json({ success: false, message: 'মেডিকেল/হসপিটালের তথ্য এবং যোগাযোগের ব্যক্তি সঠিকভাবে পূরণ করুন।' });
        }
    }

    const query = `
        INSERT INTO applications (
            type, name, email, password, phone, location, address, latitude, longitude,
            blood_group, profession, donation_count, last_donation_date, age, health_notes,
            contact_person, license_number, icu_available, emergency_bed_available
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [
        type, name, email, password, cleanPhone, location, address, latitude, longitude,
        bloodGroup, profession, donationCount, lastDonationDate || null, age, healthNotes,
        contactPerson, licenseNumber, Number(icuAvailable), Number(emergencyBedAvailable)
    ], (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ success: false, message: 'এই ইমেইল দিয়ে একই ধরনের একটি আবেদন আগে থেকেই আছে।' });
            }
            return res.status(500).json({ success: false, message: 'আবেদন জমা দিতে সমস্যা হয়েছে।' });
        }
        res.json({ success: true, message: 'আপনার আবেদন জমা হয়েছে। অ্যাডমিন approve করলে ইমেইল/মেসেজে ড্যাশবোর্ড লিংক পাঠানো হবে।' });
    });
});


// --- Super Admin APIs ---
const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY || "TanjilBoss@2026"; 

app.post('/api/superadmin/verify', (req, res) => {
    const rootUser = normalizeText(req.body.rootUser);
    const masterKey = normalizeText(req.body.masterKey);

    if (rootUser === 'admin' && masterKey === SUPER_ADMIN_KEY) {
        return res.json({ success: true, message: 'Access granted.' });
    }

    res.status(403).json({ success: false, message: 'ACCESS DENIED! Invalid Credentials.' });
});

// --- [সুপার অ্যাডমিন] নতুন হসপিটাল যুক্ত করার API ---
app.post('/api/superadmin/create-hospital', (req, res) => {
    const { masterKey } = req.body;
    const name = normalizeText(req.body.name);
    const email = normalizeText(req.body.email).toLowerCase();
    const location = normalizeText(req.body.location);
    const phone = normalizeText(req.body.phone);
    const address = toNullableText(req.body.address);
    const latitude = toNullableNumber(req.body.latitude);
    const longitude = toNullableNumber(req.body.longitude);
    const contactPerson = toNullableText(req.body.contactPerson);
    const licenseNumber = toNullableText(req.body.licenseNumber);
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);
    const icuAvailable = req.body.icuAvailable === '' || req.body.icuAvailable == null ? 0 : Number(req.body.icuAvailable);
    const emergencyBedAvailable = req.body.emergencyBedAvailable === '' || req.body.emergencyBedAvailable == null ? 0 : Number(req.body.emergencyBedAvailable);

    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    if (!name || !location || !username || !password || !isNonNegativeInteger(icuAvailable) || !isNonNegativeInteger(emergencyBedAvailable)) {
        return res.status(400).json({ success: false, message: 'হসপিটালের তথ্য সঠিকভাবে পূরণ করুন।' });
    }

    const query = `
        INSERT INTO hospitals (
            name, email, location, phone, address, latitude, longitude, contact_person,
            license_number, username, password, icu_available, emergency_bed_available, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
    `;
    db.query(query, [
        name, email || null, location, phone || null, address, latitude, longitude,
        contactPerson, licenseNumber, username, password, Number(icuAvailable), Number(emergencyBedAvailable)
    ], (err) => {
        if (err) {
            if(err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'ইউজারনেমটি আগে থেকেই আছে।' });
            return res.status(500).json({ success: false, message: 'হসপিটাল যুক্ত করতে সমস্যা হয়েছে।' });
        }
        res.json({ success: true, message: `${name}-এর লগিন অ্যাক্সেস তৈরি সম্পন্ন হয়েছে!` });
    });
});

// --- [সুপার অ্যাডমিন] নতুন ডোনার অ্যাকাউন্ট তৈরি করার API ---
app.post('/api/superadmin/create-donor', (req, res) => {
    const { masterKey } = req.body;
    const name = normalizeText(req.body.name);
    const email = normalizeText(req.body.email).toLowerCase();
    const bloodGroup = normalizeText(req.body.bloodGroup);
    const location = normalizeText(req.body.location);
    const address = toNullableText(req.body.address);
    const latitude = toNullableNumber(req.body.latitude);
    const longitude = toNullableNumber(req.body.longitude);
    const phone = normalizeText(req.body.phone);
    const profession = toNullableText(req.body.profession);
    const donationCount = req.body.donationCount === '' || req.body.donationCount == null ? 0 : Number(req.body.donationCount);
    const lastDonationDate = toNullableText(req.body.lastDonationDate);
    const age = req.body.age === '' || req.body.age == null ? null : Number(req.body.age);
    const healthNotes = toNullableText(req.body.healthNotes);
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);
    const status = normalizeText(req.body.status) || 'Available';

    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    if (!name || !ALLOWED_BLOOD_GROUPS.includes(bloodGroup) || !location || !phone || !username || !password || !ALLOWED_DONOR_STATUSES.includes(status) || !Number.isInteger(donationCount) || donationCount < 0) {
        return res.status(400).json({ success: false, message: 'ডোনারের তথ্য সঠিকভাবে পূরণ করুন।' });
    }
    if (age !== null && (!Number.isInteger(age) || age < 18 || age > 80)) {
        return res.status(400).json({ success: false, message: 'ডোনারের বয়স ১৮ থেকে ৮০ এর মধ্যে দিন।' });
    }

    const query = `
        INSERT INTO donors (
            name, email, blood_group, location, address, latitude, longitude, phone,
            profession, donation_count, last_donation_date, age, health_notes, username, password, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(query, [
        name, email || null, bloodGroup, location, address, latitude, longitude, phone,
        profession, donationCount, lastDonationDate || null, age, healthNotes, username, password, status
    ], (err) => {
        if (err) {
            if(err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'ইউজারনেমটি আগে থেকেই আছে।' });
            return res.status(500).json({ success: false, message: 'ডোনার যুক্ত করতে সমস্যা হয়েছে।' });
        }
        res.json({ success: true, message: `ডোনার ${name}-এর অ্যাকাউন্ট তৈরি হয়েছে!` });
    });
});

// --- [সুপার অ্যাডমিন] Pending application list ---
app.post('/api/superadmin/applications', (req, res) => {
    const { masterKey } = req.body;
    const status = normalizeText(req.body.status) || 'Pending';

    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    if (!ALLOWED_APPLICATION_STATUSES.includes(status)) return res.status(400).json({ success: false, message: 'স্ট্যাটাস সঠিক নয়।' });

    const query = `
        SELECT id, type, name, email, phone, location, address, latitude, longitude, blood_group,
               profession, donation_count, last_donation_date, age, health_notes, contact_person,
               license_number, icu_available, emergency_bed_available, status, review_message, created_at
        FROM applications
        WHERE status = ?
        ORDER BY created_at DESC
    `;

    db.query(query, [status], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'আবেদন লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

// --- [সুপার অ্যাডমিন] Dashboard live stats ---
app.post('/api/superadmin/stats', (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });

    const query = `
        SELECT
            (SELECT COUNT(*) FROM applications WHERE status = 'Pending') AS pendingApplications,
            (SELECT COUNT(*) FROM applications WHERE status = 'Approved') AS approvedApplications,
            (SELECT COUNT(*) FROM applications WHERE status = 'Rejected') AS rejectedApplications,
            (SELECT COUNT(*) FROM donors WHERE status != 'Suspended') AS totalDonors,
            (SELECT COUNT(*) FROM donors WHERE status = 'Available') AS availableDonors,
            (SELECT COUNT(*) FROM hospitals WHERE status = 'Active') AS activeHospitals,
            (SELECT COALESCE(SUM(icu_available), 0) FROM hospitals WHERE status = 'Active') AS totalIcuBeds,
            (SELECT COALESCE(SUM(emergency_bed_available), 0) FROM hospitals WHERE status = 'Active') AS totalEmergencyBeds
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Stats লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results[0] });
    });
});

// --- [সুপার অ্যাডমিন] Donor/Hospital user list ---
app.post('/api/superadmin/users', (req, res) => {
    const { masterKey } = req.body;
    const type = normalizeText(req.body.type);

    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    if (!['donors', 'hospitals', 'doctors'].includes(type)) return res.status(400).json({ success: false, message: 'ইউজার টাইপ সঠিক নয়।' });

    const query = type === 'donors'
        ? `SELECT d.id, d.name, d.email, d.blood_group, d.location, d.address, d.latitude, d.longitude, d.phone,
                  d.profession, d.donation_count, d.last_donation_date, d.age, d.health_notes,
                  d.username, d.password, d.status, d.created_at,
                  (SELECT COUNT(*) FROM donor_requests dr WHERE dr.donor_id = d.id) as total_requests,
                  (SELECT COUNT(*) FROM donor_requests dr WHERE dr.donor_id = d.id AND dr.status = 'Accepted') as accepted_requests,
                  (SELECT COUNT(*) FROM donor_requests dr WHERE dr.donor_id = d.id AND dr.status = 'Rejected') as rejected_requests
           FROM donors d
           ORDER BY d.created_at DESC`
        : type === 'hospitals'
        ? `SELECT id, name, email, location, phone, address, latitude, longitude, contact_person,
                  license_number, username, password, icu_available, emergency_bed_available,
                  status, created_at
           FROM hospitals
           ORDER BY created_at DESC`
        : `SELECT id, name, email, phone, district as location, specialties, designation, experience_years, fee,
                  treated_diseases, username, password, status, created_at
           FROM doctors
           ORDER BY created_at DESC`;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'ইউজার লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

// --- [সুপার অ্যাডমিন] Donor/Hospital user edit ---
app.put('/api/superadmin/update-user', (req, res) => {
    const { masterKey } = req.body;
    const type = normalizeText(req.body.type);
    const id = Number(req.body.id);

    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    if (!Number.isInteger(id) || !['donors', 'hospitals', 'doctors'].includes(type)) {
        return res.status(400).json({ success: false, message: 'আপডেট রিকোয়েস্ট সঠিক নয়।' });
    }

    const name = normalizeText(req.body.name);
    const email = normalizeText(req.body.email).toLowerCase();
    const location = normalizeText(req.body.location);
    const phone = normalizeText(req.body.phone);
    const address = toNullableText(req.body.address);
    const latitude = toNullableNumber(req.body.latitude);
    const longitude = toNullableNumber(req.body.longitude);
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);

    if (!name || !location || !username || !password) {
        return res.status(400).json({ success: false, message: 'নাম, লোকেশন, ইউজারনেম ও পাসওয়ার্ড পূরণ করুন।' });
    }

    if (type === 'donors') {
        const bloodGroup = normalizeText(req.body.bloodGroup);
        const profession = toNullableText(req.body.profession);
        const donationCount = req.body.donationCount === '' || req.body.donationCount == null ? 0 : Number(req.body.donationCount);
        const lastDonationDate = toNullableText(req.body.lastDonationDate);
        const age = req.body.age === '' || req.body.age == null ? null : Number(req.body.age);
        const healthNotes = toNullableText(req.body.healthNotes);
        const status = normalizeText(req.body.status);

        if (!ALLOWED_BLOOD_GROUPS.includes(bloodGroup) || !phone || !ALLOWED_DONOR_STATUSES.includes(status) || !Number.isInteger(donationCount) || donationCount < 0) {
            return res.status(400).json({ success: false, message: 'ডোনারের তথ্য সঠিক নয়।' });
        }
        if (age !== null && (!Number.isInteger(age) || age < 18 || age > 80)) {
            return res.status(400).json({ success: false, message: 'ডোনারের বয়স ১৮ থেকে ৮০ এর মধ্যে দিন।' });
        }

        const query = `
            UPDATE donors
            SET name = ?, email = ?, blood_group = ?, location = ?, address = ?, latitude = ?, longitude = ?,
                phone = ?, profession = ?, donation_count = ?, last_donation_date = ?, age = ?,
                health_notes = ?, username = ?, password = ?, status = ?
            WHERE id = ?
        `;

        return db.query(query, [
            name, email || null, bloodGroup, location, address, latitude, longitude, phone,
            profession, donationCount, lastDonationDate || null, age, healthNotes, username, password, status, id
        ], (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'ইউজারনেমটি আগে থেকেই আছে।' });
                return res.status(500).json({ success: false, message: 'ডোনার আপডেট করতে সমস্যা হয়েছে।' });
            }
            res.json({ success: true, message: 'ডোনারের তথ্য আপডেট হয়েছে।' });
        });
    }

    if (type === 'doctors') {
        const specialties = normalizeText(req.body.specialties);
        const designation = normalizeText(req.body.designation);
        const experienceYears = req.body.experienceYears === '' || req.body.experienceYears == null ? 0 : Number(req.body.experienceYears);
        const fee = req.body.fee === '' || req.body.fee == null ? 0 : Number(req.body.fee);
        const treatedDiseases = toNullableText(req.body.treatedDiseases);
        const status = normalizeText(req.body.status);

        if (!specialties || !designation || !status || !Number.isInteger(experienceYears) || !Number.isInteger(fee)) {
            return res.status(400).json({ success: false, message: 'ডক্টরের তথ্য সঠিক নয়।' });
        }

        const query = `
            UPDATE doctors
            SET name = ?, email = ?, phone = ?, district = ?, specialties = ?, designation = ?,
                experience_years = ?, fee = ?, treated_diseases = ?, username = ?, password = ?, status = ?
            WHERE id = ?
        `;

        return db.query(query, [
            name, email || null, phone, location, specialties, designation,
            experienceYears, fee, treatedDiseases, username, password, status, id
        ], (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'ইউজারনেমটি আগে থেকেই আছে।' });
                return res.status(500).json({ success: false, message: 'ডক্টর আপডেট করতে সমস্যা হয়েছে।' });
            }
            res.json({ success: true, message: 'ডক্টরের তথ্য আপডেট হয়েছে।' });
        });
    }

    const contactPerson = toNullableText(req.body.contactPerson);
    const licenseNumber = toNullableText(req.body.licenseNumber);
    const icuAvailable = req.body.icuAvailable === '' || req.body.icuAvailable == null ? 0 : Number(req.body.icuAvailable);
    const emergencyBedAvailable = req.body.emergencyBedAvailable === '' || req.body.emergencyBedAvailable == null ? 0 : Number(req.body.emergencyBedAvailable);
    const status = normalizeText(req.body.status);

    if (!['Active', 'Inactive'].includes(status) || !isNonNegativeInteger(icuAvailable) || !isNonNegativeInteger(emergencyBedAvailable)) {
        return res.status(400).json({ success: false, message: 'হসপিটালের তথ্য সঠিক নয়।' });
    }

    const query = `
        UPDATE hospitals
        SET name = ?, email = ?, location = ?, phone = ?, address = ?, latitude = ?, longitude = ?,
            contact_person = ?, license_number = ?, username = ?, password = ?,
            icu_available = ?, emergency_bed_available = ?, status = ?
        WHERE id = ?
    `;

    db.query(query, [
        name, email || null, location, phone || null, address, latitude, longitude,
        contactPerson, licenseNumber, username, password,
        Number(icuAvailable), Number(emergencyBedAvailable), status, id
    ], (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'ইউজারনেমটি আগে থেকেই আছে।' });
            return res.status(500).json({ success: false, message: 'হসপিটাল আপডেট করতে সমস্যা হয়েছে।' });
        }
        res.json({ success: true, message: 'হসপিটালের তথ্য আপডেট হয়েছে।' });
    });
});

// --- [সুপার অ্যাডমিন] Application approve/reject ---
app.post('/api/superadmin/review-application', (req, res) => {
    const { masterKey } = req.body;
    const applicationId = Number(req.body.applicationId);
    const decision = normalizeText(req.body.decision);
    const reviewMessage = toNullableText(req.body.reviewMessage);

    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    if (!Number.isInteger(applicationId) || !['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ success: false, message: 'রিভিউ রিকোয়েস্ট সঠিক নয়।' });
    }

    db.query('SELECT * FROM applications WHERE id = ? AND status = "Pending"', [applicationId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'আবেদন খুঁজতে সমস্যা হয়েছে।' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Pending আবেদন পাওয়া যায়নি।' });

        const application = results[0];

        if (decision === 'reject') {
            const message = reviewMessage || 'আপনার আবেদনটি এই মুহূর্তে অনুমোদন করা হয়নি।';
            return db.query(
                'UPDATE applications SET status = "Rejected", review_message = ?, reviewed_at = NOW() WHERE id = ?',
                [message, applicationId],
                (updateErr) => {
                    if (updateErr) return res.status(500).json({ success: false, message: 'রিজেক্ট করতে সমস্যা হয়েছে।' });
                    res.json({ success: true, message: 'আবেদনটি reject করা হয়েছে।' });
                }
            );
        }

        const dashboardLink = application.type === 'donor' ? '/donor-panel' : '/hospital-panel';
        const message = `আপনার LifeLine আবেদন approve হয়েছে। Login: ${application.email}, Dashboard: ${dashboardLink}`;

        if (application.type === 'donor') {
            const query = `
                INSERT INTO donors (
                    name, email, blood_group, location, address, latitude, longitude, phone,
                    profession, donation_count, last_donation_date, age, health_notes,
                    username, password, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available')
            `;

            return db.query(query, [
                application.name, application.email, application.blood_group, application.location,
                application.address, application.latitude, application.longitude, application.phone,
                application.profession, Number(application.donation_count || 0), application.last_donation_date,
                application.age, application.health_notes, application.email, application.password
            ], (insertErr) => {
                if (insertErr) {
                    if (insertErr.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'এই ইমেইল/ইউজারনেম দিয়ে ডোনার অ্যাকাউন্ট আগে থেকেই আছে।' });
                    return res.status(500).json({ success: false, message: 'ডোনার অ্যাকাউন্ট তৈরি করতে সমস্যা হয়েছে।' });
                }

                db.query('UPDATE applications SET status = "Approved", review_message = ?, reviewed_at = NOW() WHERE id = ?', [message, applicationId], (updateErr) => {
                    if (updateErr) return res.status(500).json({ success: false, message: 'আবেদন approve হলেও status আপডেট হয়নি।' });
                    console.log(`Approval message for ${application.email}: ${message}`);
                    res.json({ success: true, message: 'ডোনার আবেদন approve হয়েছে। ড্যাশবোর্ড লিংক মেসেজ প্রস্তুত।' });
                });
            });
        }

        const query = `
            INSERT INTO hospitals (
                name, email, location, phone, address, latitude, longitude, contact_person,
                license_number, username, password, icu_available, emergency_bed_available, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
        `;

        db.query(query, [
            application.name, application.email, application.location, application.phone,
            application.address, application.latitude, application.longitude, application.contact_person,
            application.license_number, application.email, application.password,
            Number(application.icu_available || 0), Number(application.emergency_bed_available || 0)
        ], (insertErr) => {
            if (insertErr) {
                if (insertErr.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'এই ইমেইল/ইউজারনেম দিয়ে হসপিটাল অ্যাকাউন্ট আগে থেকেই আছে।' });
                return res.status(500).json({ success: false, message: 'হসপিটাল অ্যাকাউন্ট তৈরি করতে সমস্যা হয়েছে।' });
            }

            db.query('UPDATE applications SET status = "Approved", review_message = ?, reviewed_at = NOW() WHERE id = ?', [message, applicationId], (updateErr) => {
                if (updateErr) return res.status(500).json({ success: false, message: 'আবেদন approve হলেও status আপডেট হয়নি।' });
                console.log(`Approval message for ${application.email}: ${message}`);
                res.json({ success: true, message: 'মেডিকেল/হসপিটাল আবেদন approve হয়েছে। ড্যাশবোর্ড লিংক মেসেজ প্রস্তুত।' });
            });
        });
    });
});

// --- [সুপার অ্যাডমিন] যেকোনো ইউজার (Hospital/Donor) ডিলিট করা ---
app.delete('/api/superadmin/delete-user', (req, res) => {
    const { masterKey, type, id } = req.body; // type হবে 'donors' অথবা 'hospitals'
    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    if (!ALLOWED_USER_TABLES.includes(type) || !Number.isInteger(Number(id))) {
        return res.status(400).json({ success: false, message: 'ডিলিট রিকোয়েস্ট সঠিক নয়।' });
    }

    const query = `DELETE FROM ${type} WHERE id = ?`;
    db.query(query, [id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'ডিলিট করতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'অ্যাকাউন্টটি সফলভাবে মুছে ফেলা হয়েছে!' });
    });
});


// --- Hospital Portal APIs ---

// --- হসপিটাল লগিন ---
app.post('/api/hospital/login', (req, res) => {
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);
    const query = "SELECT id, name, email, phone, location, address, latitude, longitude, contact_person, license_number, api_key, icu_available, emergency_bed_available FROM hospitals WHERE username = ? AND password = ? AND status = 'Active'";
    db.query(query, [username, password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
        if (results.length > 0) res.json({ success: true, message: 'লগিন সফল!', hospitalData: results[0] });
        else res.json({ success: false, message: 'ভুল ইউজারনেম/পাসওয়ার্ড।' });
    });
});

// --- হসপিটালের সিট আপডেট ---
app.post('/api/hospital/update-beds', (req, res) => {
    const { hospitalId, icu, emergency } = req.body;
    if (!Number.isInteger(Number(hospitalId)) || !isNonNegativeInteger(icu) || !isNonNegativeInteger(emergency)) {
        return res.status(400).json({ success: false, message: 'বেড সংখ্যা সঠিক নয়।' });
    }

    const query = 'UPDATE hospitals SET icu_available = ?, emergency_bed_available = ? WHERE id = ?';
    db.query(query, [Number(icu), Number(emergency), Number(hospitalId)], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'আপডেট করতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'লাইভ সিট আপডেট হয়েছে!' });
    });
});

// --- হসপিটালের API Key জেনারেট বা রি-জেনারেট করা ---
app.post('/api/hospital/regenerate-api-key', (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    if (!Number.isInteger(hospitalId) || hospitalId <= 0) {
        return res.status(400).json({ success: false, message: 'হসপিটাল আইডি সঠিক নয়।' });
    }

    // Generate a secure, unique api key
    const newApiKey = 'll_live_' + crypto.randomBytes(24).toString('hex');

    const query = 'UPDATE hospitals SET api_key = ? WHERE id = ? AND status = "Active"';
    db.query(query, [newApiKey, hospitalId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'API Key জেনারেট করতে সমস্যা হয়েছে।' });
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'হসপিটাল পাওয়া যায়নি বা অ্যাকাউন্টটি সক্রিয় নয়।' });
        }
        res.json({ success: true, apiKey: newApiKey, message: 'নতুন API Key সফলভাবে তৈরি হয়েছে!' });
    });
});

// --- Secure API for Automated Hospital Updates ---
/**
 * POST /api/v1/hospital/update-beds
 * Public API for automated third-party tools or medical devices to update beds.
 * Requires Authentication: x-api-key header OR Authorization Bearer token.
 */
app.post('/api/v1/hospital/update-beds', (req, res) => {
    // Extract key from header or bearer token
    let apiKey = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];
    if (!apiKey && authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.substring(7);
    }

    if (!apiKey) {
        return res.status(401).json({ 
            success: false, 
            error: 'Unauthorized', 
            message: 'API Key missing. Provide API Key in x-api-key header or as Bearer Token.' 
        });
    }

    const icu = req.body.icu_available;
    const emergency = req.body.emergency_bed_available;

    if (icu === undefined && emergency === undefined) {
        return res.status(400).json({ 
            success: false, 
            error: 'Bad Request', 
            message: 'Provide at least one parameter to update (icu_available or emergency_bed_available).' 
        });
    }

    // Authenticate the key
    db.query('SELECT id, name, icu_available, emergency_bed_available FROM hospitals WHERE api_key = ? AND status = "Active"', [apiKey], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: 'Database Error', message: 'সার্ভার ডেটাবেস এরর।' });
        if (results.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'Forbidden', 
                message: 'Invalid API Key or hospital account is inactive.' 
            });
        }

        const hospital = results[0];
        const newIcu = icu !== undefined ? Number(icu) : hospital.icu_available;
        const newEmergency = emergency !== undefined ? Number(emergency) : hospital.emergency_bed_available;

        if (!isNonNegativeInteger(newIcu) || !isNonNegativeInteger(newEmergency)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Bad Request', 
                message: 'Bed numbers must be non-negative integers.' 
            });
        }

        db.query('UPDATE hospitals SET icu_available = ?, emergency_bed_available = ? WHERE id = ?', [newIcu, newEmergency, hospital.id], (updateErr) => {
            if (updateErr) return res.status(500).json({ success: false, error: 'Database Error', message: 'সিট আপডেট করতে ব্যর্থ।' });
            
            res.json({
                success: true,
                message: 'Beds updated successfully via automated API!',
                data: {
                    hospitalName: hospital.name,
                    icu_available: newIcu,
                    emergency_bed_available: newEmergency,
                    updated_at: new Date()
                }
            });
        });
    });
});


// --- Donor Portal APIs ---

// --- ইউনিফাইড লগিন (অটোম্যাটিক রোল ডিটেকশন) ---
app.post('/api/unified-login', async (req, res) => {
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);
    const fcmToken = req.body.fcmToken ? normalizeText(req.body.fcmToken) : null;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'ইউজারনেম এবং পাসওয়ার্ড দিন।' });
    }

    try {
        // ১. হসপিটাল অ্যাডমিন চেক
        const hospitalRows = await dbQuery(
            "SELECT id, name, email, phone, location, address, latitude, longitude, contact_person, license_number, api_key, icu_available, emergency_bed_available FROM hospitals WHERE username = ? AND password = ? AND status = 'Active'",
            [username, password]
        );
        if (hospitalRows.length > 0) {
            return res.json({
                success: true,
                role: 'hospital',
                message: 'হসপিটাল পোর্টাল লগিন সফল!',
                hospitalData: hospitalRows[0]
            });
        }

        // ৩. ডাক্তার চেক
        const doctorRows = await dbQuery(
            "SELECT id, name, email, phone, district, specialties, designation, experience_years, fee, username, status FROM doctors WHERE username = ? AND password = ? AND status = 'Active'",
            [username, password]
        );
        if (doctorRows.length > 0) {
            return res.json({
                success: true,
                role: 'doctor',
                message: 'ডক্টর পোর্টাল লগিন সফল!',
                doctorData: doctorRows[0]
            });
        }

        // ৪. রক্তদাতা (Donor) চেক
        const donorRows = await dbQuery(
            "SELECT id, name, email, phone, blood_group, location, address, latitude, longitude, profession, donation_count, last_donation_date, age, health_notes, status FROM donors WHERE username = ? AND password = ? AND status != 'Suspended'",
            [username, password]
        );
        if (donorRows.length > 0) {
            const donorData = donorRows[0];
            if (fcmToken) {
                await dbQuery("UPDATE donors SET fcm_token = ? WHERE id = ?", [fcmToken, donorData.id]).catch(() => {});
            }
            return res.json({
                success: true,
                role: 'donor',
                message: 'রক্তদাতা লগিন সফল!',
                donorData
            });
        }

        // ৫. কোনো অ্যাকাউন্ট পাওয়া না গেলে
        return res.json({ success: false, message: 'ভুল ইউজারনেম অথবা পাসওয়ার্ড।' });

    } catch (err) {
        console.error('Unified login error:', err.message);
        res.status(500).json({ success: false, message: 'সার্ভার কানেকশন এরর।' });
    }
});

// --- ডোনার লগিন ---
app.post('/api/donor/login', (req, res) => {
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);
    const fcmToken = req.body.fcmToken ? normalizeText(req.body.fcmToken) : null;
    
    const query = "SELECT id, name, email, phone, blood_group, location, address, latitude, longitude, profession, donation_count, last_donation_date, age, health_notes, status FROM donors WHERE username = ? AND password = ? AND status != 'Suspended'";
    db.query(query, [username, password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
        if (results.length > 0) {
            const donorData = results[0];
            if (fcmToken) {
                db.query("UPDATE donors SET fcm_token = ? WHERE id = ?", [fcmToken, donorData.id], (updateErr) => {
                    if (updateErr) console.error("Failed to update FCM token for donor", donorData.id);
                });
            }
            res.json({ success: true, message: 'লগিন সফল!', donorData });
        } else {
            res.json({ success: false, message: 'ভুল ইউজারনেম/পাসওয়ার্ড।' });
        }
    });
});

// --- ডোনারের স্ট্যাটাস পরিবর্তন (Available/Busy) ---
app.post('/api/donor/update-status', (req, res) => {
    const donorId = Number(req.body.donorId);
    const status  = String(req.body.status || '').trim();

    if (!Number.isInteger(donorId) || donorId <= 0) {
        return res.status(400).json({ success: false, message: 'ডোনার আইডি সঠিক নয়।' });
    }
    if (!ALLOWED_DONOR_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: `স্ট্যাটাস শুধুমাত্র '${ALLOWED_DONOR_STATUSES.join("' বা '")}' হতে পারবে।` });
    }

    const query = 'UPDATE donors SET status = ? WHERE id = ? AND status != "Suspended"';
    db.query(query, [status, donorId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।' });
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'ডোনার পাওয়া যায়নি বা একাউন্ট সাসপেন্ড।' });
        }
        // Return confirmed status so clients can trust the DB value
        res.json({ success: true, status, message: `স্ট্যাটাস সফলভাবে '${status}' তে আপডেট করা হয়েছে!` });
    });
});

// --- ডোনারের লাইভ স্ট্যাটাস ফেচ করা ---
// GET /api/donor/status?donorId=X  — used by app & web on focus/load
app.get('/api/donor/status', (req, res) => {
    const donorId = Number(req.query.donorId);
    if (!Number.isInteger(donorId) || donorId <= 0) {
        return res.status(400).json({ success: false, message: 'ডোনার আইডি সঠিক নয়।' });
    }
    db.query('SELECT status FROM donors WHERE id = ?', [donorId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'ডোনার পাওয়া যায়নি।' });
        res.json({ success: true, status: results[0].status });
    });
});

// --- ডোনার প্রোফাইল আপডেট ---
app.post('/api/donor/update-profile', async (req, res) => {
    const { donorId, phone, age, profession, location, address, latitude, longitude } = req.body;
    if (!Number.isInteger(Number(donorId)) || !phone || !location) {
        return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য সঠিক নয়।' });
    }

    const cleanPhone = validateAndNormalizeBDPhone(phone);
    if (!cleanPhone) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।' });
    }

    const parsedAge = age === '' || age == null ? null : Number(age);
    if (parsedAge !== null) {
        if (!Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 80) {
            return res.status(400).json({ success: false, message: 'ডোনারের বয়স ১৮ থেকে ৮০ এর মধ্যে হতে হবে।' });
        }
    }

    if (profession && profession.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'পেশা সঠিকভাবে লিখুন (কমপক্ষে ২ অক্ষর)।' });
    }

    if (latitude !== null && longitude !== null && !validateCoordinates(latitude, longitude)) {
        return res.status(400).json({ success: false, message: 'অবস্থানের অক্ষাংশ ও দ্রাঘিমাংশ সঠিক নয়।' });
    }

    try {
        await dbQuery(
            `UPDATE donors SET phone = ?, age = ?, profession = ?, location = ?, address = ?, latitude = ?, longitude = ? WHERE id = ?`,
            [cleanPhone, parsedAge, profession || null, location, address || null, latitude || null, longitude || null, Number(donorId)]
        );
        const results = await dbQuery(
            `SELECT id, name, email, phone, blood_group, location, address, latitude, longitude, profession, donation_count, last_donation_date, age, health_notes, status FROM donors WHERE id = ?`,
            [Number(donorId)]
        );
        if (results.length === 0) return res.json({ success: true, message: 'আপডেট সফল হয়েছে।' });
        res.json({ success: true, message: 'আপনার প্রোফাইল সফলভাবে আপডেট হয়েছে!', donorData: results[0] });
    } catch (err) {
        console.error('Donor profile update error:', err.message);
        res.status(500).json({ success: false, message: 'প্রোফাইল আপডেট করতে সমস্যা হয়েছে।' });
    }
});

// --- হসপিটাল প্রোফাইল আপডেট ---
app.post('/api/hospital/update-profile', async (req, res) => {
    const { hospitalId, icuAvailable, emergencyBedAvailable, phone, contactPerson, location, address, latitude, longitude } = req.body;
    if (!Number.isInteger(Number(hospitalId)) || !location || !phone || !contactPerson) {
        return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য সঠিক নয়।' });
    }

    const cleanPhone = validateAndNormalizeBDPhone(phone);
    if (!cleanPhone) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।' });
    }

    if (!validateName(contactPerson)) {
        return res.status(400).json({ success: false, message: 'যোগাযোগের ব্যক্তির নাম সঠিক নয় (২-৫০ অক্ষরের মধ্যে, শুধু অক্ষর, ডট বা স্পেস)।' });
    }

    const icu = icuAvailable === '' || icuAvailable == null ? 0 : Number(icuAvailable);
    const emergency = emergencyBedAvailable === '' || emergencyBedAvailable == null ? 0 : Number(emergencyBedAvailable);
    if (!isNonNegativeInteger(icu) || !isNonNegativeInteger(emergency)) {
        return res.status(400).json({ success: false, message: 'বেড সংখ্যা সঠিক নয় (অবশ্যই অ-ঋণাত্মক পূর্ণসংখ্যা হতে হবে)।' });
    }

    if (latitude !== null && longitude !== null && !validateCoordinates(latitude, longitude)) {
        return res.status(400).json({ success: false, message: 'অবস্থানের অক্ষাংশ ও দ্রাঘিমাংশ সঠিক নয়।' });
    }

    try {
        await dbQuery(
            `UPDATE hospitals SET icu_available = ?, emergency_bed_available = ?, phone = ?, contact_person = ?, location = ?, address = ?, latitude = ?, longitude = ? WHERE id = ?`,
            [Number(icu), Number(emergency), cleanPhone, contactPerson, location, address || null, latitude || null, longitude || null, Number(hospitalId)]
        );
        const results = await dbQuery(
            `SELECT id, name, email, phone, location, address, latitude, longitude, contact_person, license_number, api_key, icu_available, emergency_bed_available FROM hospitals WHERE id = ?`,
            [Number(hospitalId)]
        );
        if (results.length === 0) return res.json({ success: true, message: 'আপডেট সফল হয়েছে।' });
        res.json({ success: true, message: 'আপনার প্রোফাইল সফলভাবে আপডেট হয়েছে!', hospitalData: results[0] });
    } catch (err) {
        console.error('Hospital profile update error:', err.message);
        res.status(500).json({ success: false, message: 'প্রোফাইল আপডেট করতে সমস্যা হয়েছে।' });
    }
});

// --- ডোনারের রিকোয়েস্ট লিস্ট ফেচ করা ---
app.post('/api/donor/requests', async (req, res) => {
    const donorId = Number(req.body.donorId);
    if (!Number.isInteger(donorId)) return res.status(400).json({ success: false, message: 'ডোনার আইডি সঠিক নয়।' });

    try {
        const activeRequestRows = await dbQuery(`
            SELECT DISTINCT dr.request_id
            FROM donor_requests dr
            JOIN blood_requests br ON dr.request_id = br.id
            WHERE dr.donor_id = ?
              AND br.status = 'Pending'
              AND dr.status = 'Pending'
              AND dr.notified_at IS NOT NULL
        `, [donorId]);
        for (const row of activeRequestRows) {
            await activateNextDonor(row.request_id);
        }
    } catch (queueErr) {
        console.error('Donor request queue refresh failed:', queueErr.message);
    }

    const query = `
        SELECT br.*, dr.status as response_status, dr.request_id, dr.notified_at, dr.responded_at, dr.distance_km 
        FROM donor_requests dr
        JOIN blood_requests br ON dr.request_id = br.id
        WHERE dr.donor_id = ?
          AND dr.notified_at IS NOT NULL
        ORDER BY br.created_at DESC
    `;
    try {
        const results = await dbQuery(query, [donorId]);
        res.json({ success: true, data: results });
    } catch (err) {
        res.status(500).json({ success: false, message: 'রিকোয়েস্ট লোড করতে সমস্যা হয়েছে।' });
    }
});



// --- ডোনারের Pending রিকোয়েস্ট লিস্ট ফেচ করা ---
// Returns only requests that are:
//   1. Assigned to this donor and still 'Pending'
//   2. Created within the last 5 minutes (not yet expired)
app.post('/api/donor/pending-requests', async (req, res) => {
    const donorId = Number(req.body.donorId);
    if (!Number.isInteger(donorId) || donorId <= 0) {
        return res.status(400).json({ success: false, message: 'ডোনার আইডি সঠিক নয়।' });
    }

    try {
        const activeRequestRows = await dbQuery(`
            SELECT DISTINCT dr.request_id
            FROM donor_requests dr
            JOIN blood_requests br ON dr.request_id = br.id
            WHERE dr.donor_id = ?
              AND br.status = 'Pending'
              AND dr.status = 'Pending'
              AND dr.notified_at IS NOT NULL
        `, [donorId]);
        for (const row of activeRequestRows) {
            await activateNextDonor(row.request_id);
        }
    } catch (queueErr) {
        console.error('Donor pending queue refresh failed:', queueErr.message);
    }

    const query = `
        SELECT br.*, dr.status as response_status, dr.request_id, dr.notified_at, dr.responded_at, dr.distance_km 
        FROM donor_requests dr
        JOIN blood_requests br ON dr.request_id = br.id
        WHERE dr.donor_id = ?
          AND dr.status = 'Pending'
          AND dr.notified_at IS NOT NULL
          AND DATE_ADD(dr.notified_at, INTERVAL ? MINUTE) > NOW()
        ORDER BY br.created_at DESC
    `;
    try {
        const results = await dbQuery(query, [donorId, REQUEST_EXPIRY_MINUTES]);
        res.json({ success: true, data: results });
    } catch (err) {
        res.status(500).json({ success: false, message: 'রিকোয়েস্ট লোড করতে সমস্যা হয়েছে।' });
    }
});

// --- ওয়েব পেজের জন্য Pending Requests (login ছাড়া, শুধু donorId দিয়ে) ---
// এই endpoint login state চেক করে না — শুধু active requests দেখায়
// যাতে app-এ login না করলেও web-এ দেখতে পায়
app.post('/api/donor/web-pending', async (req, res) => {
    const donorId = Number(req.body.donorId);
    if (!Number.isInteger(donorId) || donorId <= 0) {
        return res.status(400).json({ success: false, message: 'ডোনার আইডি সঠিক নয়।' });
    }

    try {
        // Trigger queue advancement first
        const activeRows = await dbQuery(`
            SELECT DISTINCT dr.request_id FROM donor_requests dr
            JOIN blood_requests br ON dr.request_id = br.id
            WHERE dr.donor_id = ? AND br.status = 'Pending' AND dr.status = 'Pending' AND dr.notified_at IS NOT NULL
        `, [donorId]);
        for (const row of activeRows) {
            await activateNextDonor(row.request_id).catch(() => {});
        }

        // Return ALL pending requests for this donor (including any still within expiry)
        const requests = await dbQuery(`
            SELECT br.id, br.blood_group, br.location, br.district, br.hospital_name,
                   br.needed_time, br.patient_disease, br.contact_number, br.created_at,
                   dr.status AS response_status, dr.notified_at, dr.responded_at, dr.distance_km
            FROM donor_requests dr
            JOIN blood_requests br ON dr.request_id = br.id
            WHERE dr.donor_id = ?
              AND dr.status = 'Pending'
              AND dr.notified_at IS NOT NULL
              AND br.status = 'Pending'
            ORDER BY dr.notified_at DESC
        `, [donorId]);

        res.json({ success: true, data: requests, count: requests.length });
    } catch (err) {
        console.error('Web pending requests error:', err.message);
        res.status(500).json({ success: false, message: 'রিকোয়েস্ট লোড করতে সমস্যা হয়েছে।' });
    }
});

// --- ডোনারের Inbox রিকোয়েস্ট লিস্ট ফেচ করা (Accepted/Rejected) ---
app.post('/api/donor/inbox', (req, res) => {
    const donorId = Number(req.body.donorId);
    if (!Number.isInteger(donorId) || donorId <= 0) {
        return res.status(400).json({ success: false, message: 'ডোনার আইডি সঠিক নয়।' });
    }

    // Explicitly select all fields the app needs to render a complete receipt card
    const query = `
        SELECT
            br.id,
            br.blood_group,
            br.location,
            br.hospital_name,
            br.needed_time,
            br.patient_disease,
            br.contact_number,
            br.status        AS request_status,
            br.created_at,
            dr.status        AS response_status,
            dr.request_id,
            dr.responded_at
        FROM donor_requests dr
        JOIN blood_requests br ON dr.request_id = br.id
        WHERE dr.donor_id = ?
          AND dr.status != 'Pending'
          AND dr.notified_at IS NOT NULL
        ORDER BY dr.created_at DESC
    `;
    db.query(query, [donorId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'ইনবক্স লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

// --- ডোনারের রিকোয়েস্ট রেসপন্স (Respond) ---
app.post('/api/donor/respond', async (req, res) => {
    const donorId  = Number(req.body.donorId);
    const requestId = Number(req.body.requestId);
    const status   = String(req.body.status || '');

    if (!Number.isInteger(donorId) || donorId <= 0 ||
        !Number.isInteger(requestId) || requestId <= 0 ||
        !['Accepted', 'Rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'রিকোয়েস্ট ডেটা সঠিক নয়।' });
    }

    try {
        const result = await dbQuery(`
            UPDATE donor_requests
            SET status = ?, responded_at = NOW()
            WHERE donor_id = ? AND request_id = ? AND status = 'Pending'
              AND notified_at IS NOT NULL
              AND DATE_ADD(notified_at, INTERVAL ? MINUTE) > NOW()
        `, [status, donorId, requestId, REQUEST_EXPIRY_MINUTES]);

        if (result.affectedRows === 0) {
            activateNextDonor(requestId).catch(e => console.error('Queue refresh after stale respond:', e.message));
            return res.status(409).json({ success: false, message: 'এই রিকোয়েস্টের সময় শেষ হয়েছে বা আপনি আগে সাড়া দিয়েছেন।' });
        }

        if (status === 'Accepted') {
            await dbQuery('UPDATE blood_requests SET status = "Completed" WHERE id = ? AND status = "Pending"', [requestId]).catch(() => {});
        } else {
            activateNextDonor(requestId).catch(e => console.error('Activate next donor after reject:', e.message));
        }

        res.json({
            success: true,
            message: status === 'Accepted'
                ? 'আপনি রিকোয়েস্টটি গ্রহণ করেছেন। রোগীকে কল করুন!'
                : 'রিকোয়েস্টটি বাতিল করা হয়েছে।'
        });
    } catch (err) {
        console.error('Donor respond error:', err.message);
        res.status(500).json({ success: false, message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।' });
    }
});

// --- ডোনার ড্যাশবোর্ড স্ট্যাটস ---
app.post('/api/donor/dashboard', (req, res) => {
    const donorId = Number(req.body.donorId);
    if (!Number.isInteger(donorId)) return res.status(400).json({ success: false, message: 'ডোনার আইডি সঠিক নয়।' });

    const query = `
        SELECT 
            (SELECT COUNT(*) FROM donor_requests WHERE donor_id = ?) AS total_requests,
            (SELECT COUNT(*) FROM donor_requests WHERE donor_id = ? AND status = 'Accepted') AS total_approved,
            d.donation_count,
            d.last_donation_date,
            (
                SELECT br.id FROM donor_requests dr 
                JOIN blood_requests br ON dr.request_id = br.id 
                WHERE dr.donor_id = ?
                  AND dr.status = 'Pending'
                  AND dr.notified_at IS NOT NULL
                  AND DATE_ADD(dr.notified_at, INTERVAL ${REQUEST_EXPIRY_MINUTES} MINUTE) > NOW()
                ORDER BY br.created_at DESC LIMIT 1
            ) AS active_request_id
        FROM donors d WHERE d.id = ?
    `;
    db.query(query, [donorId, donorId, donorId, donorId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'স্ট্যাটস লোড করতে সমস্যা হয়েছে।' });
        if(results.length > 0) {
            res.json({ success: true, data: results[0] });
        } else {
            res.json({ success: false, message: 'ডোনার পাওয়া যায়নি।' });
        }
    });
});

// --- ডোনার রিকোয়েস্ট ডিলিট করা ---
app.post('/api/donor/request-delete', (req, res) => {
    const { donorId, requestId } = req.body;
    if (!Number.isInteger(donorId) || !Number.isInteger(requestId)) {
        return res.status(400).json({ success: false, message: 'ডেটা সঠিক নয়।' });
    }
    const query = 'DELETE FROM donor_requests WHERE donor_id = ? AND request_id = ?';
    db.query(query, [donorId, requestId], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'ডিলিট করতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'মেসেজ ডিলিট করা হয়েছে।' });
    });
});

app.post('/api/request/details', (req, res) => {
    const requestId = Number(req.body.requestId);
    db.query('SELECT * FROM blood_requests WHERE id = ?', [requestId], (err, results) => {
        if (err) return res.status(500).json({success:false});
        if(results.length > 0) res.json({success:true, data:results[0]});
        else res.json({success:false, message: 'Not found'});
    });
});

// --- ডোনারের রিকোয়েস্ট রেসপন্স (Accept/Reject) - Web version ---
app.post('/api/donor/request-response', async (req, res) => {
    const { donorId, requestId, status } = req.body;
    const donorIdNumber = Number(donorId);
    const requestIdNumber = Number(requestId);
    if (!Number.isInteger(donorIdNumber) || !Number.isInteger(requestIdNumber) || !['Accepted', 'Rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'রিকোয়েস্ট ডেটা সঠিক নয়।' });
    }

    try {
        const result = await dbQuery(`
            UPDATE donor_requests
            SET status = ?, responded_at = NOW()
            WHERE donor_id = ? AND request_id = ? AND status = 'Pending'
              AND notified_at IS NOT NULL
              AND DATE_ADD(notified_at, INTERVAL ? MINUTE) > NOW()
        `, [status, donorIdNumber, requestIdNumber, REQUEST_EXPIRY_MINUTES]);

        if (result.affectedRows === 0) {
            activateNextDonor(requestIdNumber).catch(e => console.error('Queue refresh:', e.message));
            return res.status(409).json({ success: false, message: 'এই রিকোয়েস্টের সময় শেষ হয়েছে বা আপনি আগে সাড়া দিয়েছেন।' });
        }

        if (status === 'Accepted') {
            await dbQuery('UPDATE blood_requests SET status = "Completed" WHERE id = ? AND status = "Pending"', [requestIdNumber]).catch(() => {});
            console.log(`[ok] Donor #${donorIdNumber} accepted request #${requestIdNumber}`);
        } else {
            activateNextDonor(requestIdNumber).catch(e => console.error('Activate next donor:', e.message));
            console.log(`↩️ Donor #${donorIdNumber} rejected request #${requestIdNumber} — next donor will be notified`);
        }

        res.json({
            success: true,
            message: status === 'Accepted'
                ? 'আপনি রিকোয়েস্টটি গ্রহণ করেছেন। রোগীকে কল করুন!'
                : 'রিকোয়েস্টটি বাতিল করা হয়েছে। পরবর্তী ডোনারকে জানানো হচ্ছে।'
        });
    } catch (err) {
        console.error('Request-response error:', err.message);
        res.status(500).json({ success: false, message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।' });
    }
});

// --- Test Data & Utility APIs ---

/**
 * POST /api/superadmin/seed-test-donors
 * Creates test donors across all blood groups in all major districts
 */
app.post('/api/superadmin/seed-test-donors', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });

    const testDonors = [
        // Dhaka
        { name: 'Rahim Test Donor', email: 'rahim.test@lifeline.bd', blood_group: 'A+', location: 'Dhanmondi, Dhaka', address: 'Road 27, Dhanmondi', latitude: 23.7465, longitude: 90.3757, phone: '01711000001', profession: 'Student', username: 'rahim.test', password: 'test1234', status: 'Available' },
        { name: 'Karim Test Donor', email: 'karim.test@lifeline.bd', blood_group: 'B+', location: 'Mirpur, Dhaka', address: 'Mirpur-10', latitude: 23.8223, longitude: 90.3654, phone: '01711000002', profession: 'Service', username: 'karim.test', password: 'test1234', status: 'Available' },
        { name: 'Runa Test Donor', email: 'runa.test@lifeline.bd', blood_group: 'O+', location: 'Uttara, Dhaka', address: 'Uttara Sector-11', latitude: 23.8759, longitude: 90.3795, phone: '01711000003', profession: 'Teacher', username: 'runa.test', password: 'test1234', status: 'Available' },
        { name: 'Mina Test Donor', email: 'mina.test@lifeline.bd', blood_group: 'AB+', location: 'Gulshan, Dhaka', address: 'Gulshan-2', latitude: 23.7925, longitude: 90.4078, phone: '01711000004', profession: 'Engineer', username: 'mina.test', password: 'test1234', status: 'Available' },
        { name: 'Salam Test Donor', email: 'salam.test@lifeline.bd', blood_group: 'A-', location: 'Mohammadpur, Dhaka', address: 'Mohammadpur Bus Stand', latitude: 23.7630, longitude: 90.3563, phone: '01711000005', profession: 'Business', username: 'salam.test', password: 'test1234', status: 'Available' },
        { name: 'Nusrat Test Donor', email: 'nusrat.test@lifeline.bd', blood_group: 'B-', location: 'Badda, Dhaka', address: 'Badda Main Road', latitude: 23.7819, longitude: 90.4290, phone: '01711000006', profession: 'Doctor', username: 'nusrat.test', password: 'test1234', status: 'Available' },
        { name: 'Farhan Test Donor', email: 'farhan.test@lifeline.bd', blood_group: 'O-', location: 'Demra, Dhaka', address: 'Demra Bazar', latitude: 23.7148, longitude: 90.4618, phone: '01711000007', profession: 'Banker', username: 'farhan.test', password: 'test1234', status: 'Available' },
        { name: 'Sumaiya Test Donor', email: 'sumaiya.test@lifeline.bd', blood_group: 'AB-', location: 'Khilgaon, Dhaka', address: 'Khilgaon Circle', latitude: 23.7478, longitude: 90.4290, phone: '01711000008', profession: 'Nurse', username: 'sumaiya.test', password: 'test1234', status: 'Available' },
        // Chittagong
        { name: 'Jamal Chittagong', email: 'jamal.ctg@lifeline.bd', blood_group: 'A+', location: 'Chittagong City, Chittagong', address: 'Agrabad, Chittagong', latitude: 22.3282, longitude: 91.8222, phone: '01811000001', profession: 'Service', username: 'jamal.ctg', password: 'test1234', status: 'Available' },
        { name: 'Rohima Chittagong', email: 'rohima.ctg@lifeline.bd', blood_group: 'B+', location: 'Hathazari, Chittagong', address: 'Hathazari Upazila', latitude: 22.5000, longitude: 91.8333, phone: '01811000002', profession: 'Teacher', username: 'rohima.ctg', password: 'test1234', status: 'Available' },
        // Sylhet
        { name: 'Kabir Sylhet', email: 'kabir.syl@lifeline.bd', blood_group: 'O+', location: 'Sylhet Sadar, Sylhet', address: 'Zindabazar, Sylhet', latitude: 24.8949, longitude: 91.8687, phone: '01911000001', profession: 'Business', username: 'kabir.syl', password: 'test1234', status: 'Available' },
        { name: 'Poli Sylhet', email: 'poli.syl@lifeline.bd', blood_group: 'AB+', location: 'Sylhet Sadar, Sylhet', address: 'Amberkhana, Sylhet', latitude: 24.9000, longitude: 91.8650, phone: '01911000002', profession: 'Student', username: 'poli.syl', password: 'test1234', status: 'Available' },
        // Rajshahi
        { name: 'Amir Rajshahi', email: 'amir.raj@lifeline.bd', blood_group: 'A+', location: 'Rajshahi City, Rajshahi', address: 'Shaheb Bazar, Rajshahi', latitude: 24.3636, longitude: 88.6241, phone: '01611000001', profession: 'Farmer', username: 'amir.raj', password: 'test1234', status: 'Available' },
        { name: 'Lima Rajshahi', email: 'lima.raj@lifeline.bd', blood_group: 'B+', location: 'Paba, Rajshahi', address: 'Paba Upazila', latitude: 24.3800, longitude: 88.6500, phone: '01611000002', profession: 'Housewife', username: 'lima.raj', password: 'test1234', status: 'Available' },
        // Khulna
        { name: 'Hasib Khulna', email: 'hasib.khl@lifeline.bd', blood_group: 'O+', location: 'Khulna City, Khulna', address: 'Boyra, Khulna', latitude: 22.8456, longitude: 89.5403, phone: '01511000001', profession: 'Engineer', username: 'hasib.khl', password: 'test1234', status: 'Available' },
    ];

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const donor of testDonors) {
        try {
            await dbQuery(`
                INSERT INTO donors (name, email, blood_group, location, address, latitude, longitude, phone,
                    profession, donation_count, age, username, password, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 25, ?, ?, ?)
            `, [donor.name, donor.email, donor.blood_group, donor.location, donor.address,
                donor.latitude, donor.longitude, donor.phone, donor.profession,
                donor.username, donor.password, donor.status]);
            created++;
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                skipped++;
            } else {
                errors.push(`${donor.name}: ${err.message}`);
            }
        }
    }

    res.json({
        success: true,
        message: `${created} test donors created, ${skipped} already existed.`,
        created, skipped,
        errors: errors.length ? errors : undefined
    });
});

/**
 * POST /api/superadmin/seed-test-hospitals
 * Creates beautiful clinical test hospitals in major divisions with coordinates & contact info
 */
app.post('/api/superadmin/seed-test-hospitals', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });

    const testHospitals = [
        // Dhaka
        { name: 'ঢাকা মেডিকেল কলেজ হাসপাতাল', email: 'dmch.test@lifeline.bd', location: 'Ramna, Dhaka', phone: '01711112233', address: 'Bakhshibazar, Ramna, Dhaka', latitude: 23.7259, longitude: 90.3972, contact_person: 'Director (DMCH)', license_number: 'LIC-DMCH-7788', username: 'dmch.test', password: 'test1234', icu_available: 8, emergency_bed_available: 24 },
        { name: 'স্কয়ার হাসপাতাল', email: 'square.test@lifeline.bd', location: 'Dhanmondi, Dhaka', phone: '01711223344', address: '18/F Bir Uttam Qazi Nuruzzaman Sarak, Dhaka', latitude: 23.7516, longitude: 90.3814, contact_person: 'Dr. Rafiq (HR)', license_number: 'LIC-SQH-9922', username: 'square.test', password: 'test1234', icu_available: 15, emergency_bed_available: 30 },
        { name: 'এভারকেয়ার হাসপাতাল ঢাকা', email: 'evercare.test@lifeline.bd', location: 'Gulshan, Dhaka', phone: '01711334455', address: 'Plot 81, Block E, Bashundhara R/A, Dhaka', latitude: 23.8122, longitude: 90.4302, contact_person: 'Admin Lead', license_number: 'LIC-EVH-3344', username: 'evercare.test', password: 'test1234', icu_available: 20, emergency_bed_available: 45 },
        // Chittagong
        { name: 'চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল', email: 'cmch.test@lifeline.bd', location: 'Chittagong City, Chittagong', phone: '01811223344', address: 'K.B. Fazlul Kader Road, Chittagong', latitude: 22.3592, longitude: 91.8291, contact_person: 'Director (CMCH)', license_number: 'LIC-CMCH-4455', username: 'cmch.test', password: 'test1234', icu_available: 6, emergency_bed_available: 18 },
        { name: 'মেট্রোপলিটন হাসপাতাল চট্টগ্রাম', email: 'metro.ctg@lifeline.bd', location: 'Chittagong City, Chittagong', phone: '01811556677', address: 'East Nasirabad, Chittagong', latitude: 22.3638, longitude: 91.8219, contact_person: 'Superintendent', license_number: 'LIC-MHC-8877', username: 'metro.ctg', password: 'test1234', icu_available: 4, emergency_bed_available: 12 },
        // Sylhet
        { name: 'সিলেট এম এ জি ওসমানী মেডিকেল কলেজ', email: 'magmc.test@lifeline.bd', location: 'Sylhet Sadar, Sylhet', phone: '01911223344', address: 'Kajirbazar, Sylhet', latitude: 24.8986, longitude: 91.8594, contact_person: 'Emergency Lead', license_number: 'LIC-MAGMC-5566', username: 'magmc.test', password: 'test1234', icu_available: 5, emergency_bed_available: 20 },
        // Rajshahi
        { name: 'রাজশাহী মেডিকেল কলেজ হাসপাতাল', email: 'rmch.test@lifeline.bd', location: 'Rajshahi City, Rajshahi', phone: '01611223344', address: 'Rajnagar, Rajshahi', latitude: 24.3688, longitude: 88.5866, contact_person: 'Director (RMCH)', license_number: 'LIC-RMCH-1122', username: 'rmch.test', password: 'test1234', icu_available: 7, emergency_bed_available: 15 },
        // Khulna
        { name: 'খুলনা মেডিকেল কলেজ হাসপাতাল', email: 'kmch.test@lifeline.bd', location: 'Khulna City, Khulna', phone: '01511223344', address: 'Boyra, Khulna', latitude: 22.8415, longitude: 89.5441, contact_person: 'Director (KMCH)', license_number: 'LIC-KMCH-3322', username: 'kmch.test', password: 'test1234', icu_available: 6, emergency_bed_available: 16 }
    ];

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const h of testHospitals) {
        try {
            // Generate distinct api keys for test hospitals
            const apiKey = 'll_live_' + crypto.randomBytes(24).toString('hex');
            
            await dbQuery(`
                INSERT INTO hospitals (name, email, location, phone, address, latitude, longitude, 
                                      contact_person, license_number, api_key, username, password, 
                                      icu_available, emergency_bed_available, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
            `, [h.name, h.email, h.location, h.phone, h.address, h.latitude, h.longitude,
                h.contact_person, h.license_number, apiKey, h.username, h.password,
                h.icu_available, h.emergency_bed_available]);
            created++;
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                skipped++;
            } else {
                errors.push(`${h.name}: ${err.message}`);
            }
        }
    }

    res.json({
        success: true,
        message: `${created} test hospitals seeded, ${skipped} already existed.`,
        created, skipped,
        errors: errors.length ? errors : undefined
    });
});

/**
 * GET /api/superadmin/donors-view
 * Returns all donors with their request stats for admin view
 */
app.post('/api/superadmin/donors-view', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });

    try {
        const donors = await dbQuery(`
            SELECT 
                d.id, d.name, d.email, d.blood_group, d.location, d.phone, d.status,
                d.donation_count, d.last_donation_date, d.age, d.profession, d.created_at,
                d.latitude, d.longitude,
                CASE WHEN d.fcm_token IS NOT NULL THEN 1 ELSE 0 END as has_fcm_token,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.donor_id = d.id) as total_requests,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.donor_id = d.id AND dr.status = 'Accepted') as accepted_requests,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.donor_id = d.id AND dr.status = 'Rejected') as rejected_requests,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.donor_id = d.id AND dr.status = 'Pending' AND dr.notified_at IS NOT NULL) as pending_requests
            FROM donors d
            ORDER BY d.created_at DESC
        `);
        res.json({ success: true, data: donors });
    } catch (err) {
        res.status(500).json({ success: false, message: 'ডোনার লোড করতে সমস্যা হয়েছে।' });
    }
});

/**
 * GET /api/superadmin/blood-requests
 * Returns all blood requests with donor queue info
 */
app.post('/api/superadmin/blood-requests', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });

    try {
        const requests = await dbQuery(`
            SELECT 
                br.id, br.blood_group, br.location, br.district, br.hospital_name,
                br.needed_time, br.patient_disease, br.contact_number, br.status,
                br.created_at, br.expires_at,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.request_id = br.id) as total_donors_queued,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.request_id = br.id AND dr.status = 'Accepted') as accepted_count,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.request_id = br.id AND dr.status = 'Rejected') as rejected_count,
                (SELECT d.name FROM donor_requests dr JOIN donors d ON dr.donor_id = d.id WHERE dr.request_id = br.id AND dr.status = 'Accepted' LIMIT 1) as accepted_donor_name
            FROM blood_requests br
            ORDER BY br.created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, data: requests });
    } catch (err) {
        res.status(500).json({ success: false, message: 'রিকোয়েস্ট লোড করতে সমস্যা হয়েছে।' });
    }
});

// --- [পাবলিক] ডক্টর বুকিং পোর্টালের লাইভ পরিসংখ্যান (Stats) API ---
app.get('/api/public/doctor-stats', async (req, res) => {
    try {
        const doctorsRes = await dbQuery("SELECT COUNT(*) AS count FROM doctors WHERE status = 'Active'");
        const chambersRes = await dbQuery("SELECT COUNT(*) AS count FROM doctor_chambers");
        
        // Calculate sitting today (local Bangladesh time)
        const tzOffset = 6 * 60; // UTC+6
        const localTime = new Date().getTime() + (new Date().getTimezoneOffset() + tzOffset) * 60000;
        const localDate = new Date(localTime);
        const year = localDate.getFullYear();
        const month = String(localDate.getMonth() + 1).padStart(2, '0');
        const dayNum = String(localDate.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${dayNum}`;
        const weekday = localDate.getDay(); // 0: Sunday, 1: Monday, ..., 6: Saturday
        
        const activeDoctors = await dbQuery("SELECT id FROM doctors WHERE status = 'Active'");
        const activeDoctorIds = new Set(activeDoctors.map(d => d.id));
        
        let sittingTodayCount = 0;
        
        if (activeDoctorIds.size > 0) {
            const allChambers = await dbQuery("SELECT id, doctor_id, visiting_days FROM doctor_chambers WHERE doctor_id IN (?)", [Array.from(activeDoctorIds)]);
            const leaves = await dbQuery("SELECT doctor_id FROM doctor_leaves WHERE leave_date = ? AND doctor_id IN (?)", [dateString, Array.from(activeDoctorIds)]);
            const leavesSet = new Set(leaves.map(l => l.doctor_id));
            
            const overrides = await dbQuery("SELECT id, doctor_id, chamber_id, booking_status FROM chamber_date_overrides WHERE override_date = ? AND doctor_id IN (?)", [dateString, Array.from(activeDoctorIds)]);
            const overridesMap = new Map();
            overrides.forEach(o => {
                overridesMap.set(`${o.chamber_id}_${dateString}`, o);
            });
            
            const sittingDoctorIds = new Set();
            
            const validDaysMap = {
                'saturday': 6, 'sat': 6, 'শনি': 6,
                'sunday': 0, 'sun': 0, 'রবি': 0,
                'monday': 1, 'mon': 1, 'সোম': 1,
                'tuesday': 2, 'tue': 2, 'মঙ্গল': 2,
                'wednesday': 3, 'wed': 3, 'বুধ': 3,
                'thursday': 4, 'thu': 4, 'বৃহস্পতি': 4,
                'friday': 5, 'fri': 5, 'শুক্র': 5
            };

            allChambers.forEach(c => {
                if (sittingDoctorIds.has(c.doctor_id)) return;
                
                // Check if on leave
                if (leavesSet.has(c.doctor_id)) return;
                
                // Check overrides
                const override = overridesMap.get(`${c.id}_${dateString}`);
                if (override) {
                    if (override.booking_status === 'Full') return;
                    if (override.booking_status === 'Available') {
                        sittingDoctorIds.add(c.doctor_id);
                        return;
                    }
                }
                
                // Check visiting days
                const daysStr = String(c.visiting_days || '').toLowerCase();
                let allowed = [];
                if (daysStr.includes('everyday except friday')) allowed = [0,1,2,3,4,6];
                else if (daysStr.includes('everyday')) allowed = [0,1,2,3,4,5,6];
                else {
                    for (const [key, val] of Object.entries(validDaysMap)) {
                        if (daysStr.includes(key) && !allowed.includes(val)) {
                            allowed.push(val);
                        }
                    }
                    if (allowed.length === 0) allowed = [0,1,2,3,4,5,6];
                }
                
                if (allowed.includes(weekday)) {
                    sittingDoctorIds.add(c.doctor_id);
                }
            });
            
            sittingTodayCount = sittingDoctorIds.size;
        }
        
        res.json({
            success: true,
            doctors: doctorsRes[0].count,
            chambers: chambersRes[0].count,
            sitting_today: sittingTodayCount
        });
    } catch (err) {
        console.error('Doctor stats fetch error:', err.message);
        res.status(500).json({ success: false, message: 'পরিসংখ্যান লোড করতে সমস্যা হয়েছে।' });
    }
});

// --- [পাবলিক] ওয়েবসাইটের জন্য ডক্টর লিস্ট (জেলা অনুযায়ী) ---
app.get('/api/public/doctors', (req, res) => {
    const district = req.query.district ? normalizeText(req.query.district) : null;
    let query = "SELECT id, name, specialties, treated_diseases, designation, district, experience_years, fee, phone FROM doctors WHERE status = 'Active'";
    let params = [];
    if (district) {
        query += " AND district = ?";
        params.push(district);
    }
    
    db.query(query, params, (err, doctors) => {
        if (err) return res.status(500).json({ success: false, message: 'ডাক্তার লোড করতে সমস্যা হয়েছে।' });
        if (doctors.length === 0) return res.json({ success: true, data: [] });
        
        // Fetch chambers
        const doctorIds = doctors.map(d => d.id);
        db.query("SELECT * FROM doctor_chambers WHERE doctor_id IN (?)", [doctorIds], (err, chambers) => {
            if (err) return res.status(500).json({ success: false, message: 'চেম্বার লোড করতে সমস্যা হয়েছে।' });
            
            db.query("SELECT doctor_id, DATE_FORMAT(leave_date, '%Y-%m-%d') as leave_date FROM doctor_leaves WHERE doctor_id IN (?) AND leave_date >= CURDATE()", [doctorIds], (err, leaves) => {
                const leavesMap = {};
                if (leaves) {
                    leaves.forEach(l => {
                        if (!leavesMap[l.doctor_id]) leavesMap[l.doctor_id] = [];
                        leavesMap[l.doctor_id].push(l.leave_date);
                    });
                }
                
                db.query("SELECT doctor_id, chamber_id, DATE_FORMAT(override_date, '%Y-%m-%d') as override_date, max_patients, booking_status FROM chamber_date_overrides WHERE doctor_id IN (?)", [doctorIds], (err, overrides) => {
                    const overridesMap = {};
                    if (overrides) {
                        overrides.forEach(o => {
                            if (!overridesMap[o.doctor_id]) overridesMap[o.doctor_id] = [];
                            overridesMap[o.doctor_id].push(o);
                        });
                    }
                    
                    const docs = doctors.map(doc => {
                        return {
                            ...doc,
                            chambers: chambers.filter(c => c.doctor_id === doc.id),
                            leaves: leavesMap[doc.id] || [],
                            overrides: overridesMap[doc.id] || []
                        };
                    });
                    res.json({ success: true, data: docs });
                });
            });
        });
    });
});

app.get('/api/public/doctor/:id', (req, res) => {
    const doctorId = Number(req.params.id);
    db.query("SELECT id, name, specialties, treated_diseases, designation, district, experience_years, fee, phone FROM doctors WHERE id = ? AND status = 'Active'", [doctorId], (err, doctors) => {
        if (err || doctors.length === 0) return res.status(404).json({ success: false, message: 'Doctor not found.' });
        const doc = doctors[0];
        db.query("SELECT * FROM doctor_chambers WHERE doctor_id = ?", [doctorId], (err, chambers) => {
            doc.chambers = chambers || [];
            db.query("SELECT DATE_FORMAT(leave_date, '%Y-%m-%d') as leave_date FROM doctor_leaves WHERE doctor_id = ? AND leave_date >= CURDATE()", [doctorId], (err, leaves) => {
                doc.leaves = leaves ? leaves.map(l => l.leave_date) : [];
                db.query("SELECT DATE_FORMAT(override_date, '%Y-%m-%d') as override_date, chamber_id, max_patients, booking_status FROM chamber_date_overrides WHERE doctor_id = ?", [doctorId], (err, overrides) => {
                    doc.overrides = overrides || [];
                    res.json({ success: true, data: doc });
                });
            });
        });
    });
});

app.get('/api/public/doctor/chamber/:chamberId', (req, res) => {
    const chamberId = Number(req.params.chamberId);
    db.query("SELECT * FROM doctor_chambers WHERE id = ?", [chamberId], (err, chambers) => {
        if (err || chambers.length === 0) return res.status(404).json({ success: false, message: 'Chamber not found.' });
        res.json({ success: true, data: chambers[0] });
    });
});

app.get('/api/public/chamber/:chamberId/fully-booked-dates', (req, res) => {
    const chamberId = Number(req.params.chamberId);
    db.query("SELECT max_patients FROM doctor_chambers WHERE id = ?", [chamberId], (err, chambers) => {
        if (err || chambers.length === 0) return res.json({ success: true, dates: [] });
        const baseMax = chambers[0].max_patients;
        
        db.query("SELECT DATE_FORMAT(appointment_date, '%Y-%m-%d') as date, COUNT(*) as cnt FROM doctor_appointments WHERE chamber_id = ? GROUP BY appointment_date", [chamberId], (err, appts) => {
            const counts = {};
            if(appts) appts.forEach(a => counts[a.date] = a.cnt);
            
            db.query("SELECT DATE_FORMAT(override_date, '%Y-%m-%d') as date, max_patients, booking_status FROM chamber_date_overrides WHERE chamber_id = ?", [chamberId], (err, overs) => {
                const overrides = {};
                if(overs) overs.forEach(o => overrides[o.date] = o);
                
                let fullyBooked = [];
                for(let d in counts) {
                    let limit = overrides[d] && overrides[d].max_patients !== null ? overrides[d].max_patients : baseMax;
                    if(counts[d] >= limit) fullyBooked.push(d);
                }
                
                for(let d in overrides) {
                    if(overrides[d].booking_status === 'Full' || overrides[d].max_patients === 0) {
                        if(!fullyBooked.includes(d)) fullyBooked.push(d);
                    }
                }
                res.json({ success: true, dates: fullyBooked });
            });
        });
    });
});

// --- [পাবলিক] অ্যাপয়েন্টমেন্ট বুকিং ---
app.post('/api/patient/available-serials', (req, res) => {
    const { chamberId, appointmentDate } = req.body;
    db.query("SELECT doctor_id, visiting_days, max_patients FROM doctor_chambers WHERE id = ?", [chamberId], (err, chamberRes) => {
        if(err || chamberRes.length === 0) return res.json({ success: false, message: 'Chamber not found' });
        const doctorId = chamberRes[0].doctor_id;
        const visitingDays = chamberRes[0].visiting_days;
        const maxPatients = chamberRes[0].max_patients || 30;

        // Parse weekday (local style)
        const [year, month, dayNum] = appointmentDate.split('-').map(Number);
        const dateObj = new Date(year, month - 1, dayNum);
        const day = dateObj.getDay();

        // Visiting days helper
        const validDaysMap = {
            'saturday': 6, 'sat': 6, 'শনি': 6,
            'sunday': 0, 'sun': 0, 'রবি': 0,
            'monday': 1, 'mon': 1, 'সোম': 1,
            'tuesday': 2, 'tue': 2, 'মঙ্গল': 2,
            'wednesday': 3, 'wed': 3, 'বুধ': 3,
            'thursday': 4, 'thu': 4, 'বৃহস্পতি': 4,
            'friday': 5, 'fri': 5, 'শুক্র': 5
        };
        let daysStr = visitingDays.toLowerCase();
        let allowed = [];
        if(daysStr.includes('everyday except friday')) allowed = [0,1,2,3,4,6];
        else if(daysStr.includes('everyday')) allowed = [0,1,2,3,4,5,6];
        else {
            for (const [key, val] of Object.entries(validDaysMap)) {
                if(daysStr.includes(key) && !allowed.includes(val)) {
                    allowed.push(val);
                }
            }
            if(allowed.length === 0) allowed = [0,1,2,3,4,5,6];
        }

        const isNormalSittingDay = allowed.includes(day);

        db.query("SELECT * FROM doctor_leaves WHERE doctor_id = ? AND leave_date = ?", [doctorId, appointmentDate], (err, leaves) => {
            const isLeave = leaves && leaves.length > 0;
            
            db.query("SELECT * FROM chamber_date_overrides WHERE chamber_id = ? AND override_date = ?", [chamberId, appointmentDate], (err, overs) => {
                const override = overs && overs.length > 0 ? overs[0] : null;
                
                let isAvailable = isNormalSittingDay && !isLeave;
                let finalLimit = maxPatients;
                
                if (override) {
                    if (override.booking_status === 'Available') {
                        isAvailable = true;
                        finalLimit = override.max_patients;
                    } else if (override.booking_status === 'Full') {
                        isAvailable = false;
                    }
                }
                
                if(!isAvailable) {
                    return res.json({ success: true, booked: [], isFull: true });
                }
                
                db.query("SELECT serial_number FROM doctor_appointments WHERE chamber_id = ? AND appointment_date = ? AND status != 'Cancelled'", [chamberId, appointmentDate], (err, results) => {
                    if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
                    const booked = results.map(r => r.serial_number);
                    res.json({ success: true, booked, overrideMax: finalLimit });
                });
            });
        });
    });
});

app.post('/api/patient/book-appointment', (req, res) => {
    const { doctorId, chamberId, patientName, patientPhone, patientEmail, patientAge, patientGender, patientProblem, appointmentDate, paymentMethod, trxId, paymentAmount, serialNumber } = req.body;
    
    if (!doctorId || !chamberId || !patientName || !patientPhone || !patientAge || !patientGender || !appointmentDate || !paymentMethod || !trxId || !serialNumber) {
        return res.status(400).json({ success: false, message: 'সবগুলো তথ্য সঠিকভাবে পূরণ করুন।' });
    }

    const cleanPhone = validateAndNormalizeBDPhone(patientPhone);
    if (!cleanPhone) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।' });
    }

    if (!validateName(patientName)) {
        return res.status(400).json({ success: false, message: 'একটি সঠিক নাম দিন (২-৫০ অক্ষরের মধ্যে, শুধু অক্ষর, ডট বা স্পেস)।' });
    }

    if (patientEmail) {
        if (!validateEmail(patientEmail)) {
            return res.status(400).json({ success: false, message: 'একটি সঠিক ইমেইল এড্রেস দিন।' });
        }
    }

    const age = Number(patientAge);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
        return res.status(400).json({ success: false, message: 'রোগীর বয়স ০ থেকে ১২০ এর মধ্যে হতে হবে।' });
    }
    
    // Check chamber and get timing
    db.query("SELECT * FROM doctor_chambers WHERE id = ? AND doctor_id = ?", [chamberId, doctorId], (err, chambers) => {
        if (err || chambers.length === 0) return res.status(400).json({ success: false, message: 'চেম্বার পাওয়া যায়নি।' });
        
        const chamber = chambers[0];
        
        // Check if serial is already booked
        db.query("SELECT id FROM doctor_appointments WHERE chamber_id = ? AND appointment_date = ? AND serial_number = ?", [chamberId, appointmentDate, serialNumber], (err, existing) => {
            if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
            if (existing.length > 0) return res.status(400).json({ success: false, message: 'এই সিরিয়ালটি ইতিমধ্যে বুক হয়ে গেছে। অন্য সিরিয়াল নির্বাচন করুন।' });
            
            // Calculate time based on chosen serial
            const startTimeString = chamber.start_time; // '18:00:00'
            const [hours, minutes, seconds] = startTimeString.split(':').map(Number);
            let appointmentTimeMin = hours * 60 + minutes + ((serialNumber - 1) * chamber.time_per_patient_min);
            let reportingTimeMin = appointmentTimeMin - 15; // 15 mins before
            
            const formatTime = (totalMin) => {
                let h = Math.floor(totalMin / 60) % 24;
                let m = totalMin % 60;
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
            };
            
            const appointmentTime = formatTime(appointmentTimeMin);
            const reportingTime = formatTime(reportingTimeMin);
            
            const insertQuery = `
                INSERT INTO doctor_appointments (
                    doctor_id, chamber_id, patient_name, patient_phone, patient_email, 
                    patient_age, patient_gender, patient_problem, appointment_date, 
                    appointment_time, reporting_time, serial_number, payment_method, 
                    trx_id, payment_amount, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed')
            `;
            
            db.query(insertQuery, [
                doctorId, chamberId, patientName, cleanPhone, patientEmail || null,
                age, patientGender, patientProblem || '', appointmentDate,
                appointmentTime, reportingTime, serialNumber, paymentMethod, trxId, paymentAmount || 100
            ], (err, result) => {
                if (err) return res.status(500).json({ success: false, message: 'অ্যাপয়েন্টমেন্ট বুকিং ব্যর্থ হয়েছে।' });
                
                res.json({
                    success: true, 
                    message: 'অ্যাপয়েন্টমেন্ট সফলভাবে কনফার্ম হয়েছে!',
                    data: {
                        appointmentId: result.insertId,
                        serialNumber,
                        appointmentTime,
                        reportingTime,
                        appointmentDate
                    }
                });
            });
        });
    });
});

app.post('/api/patient/appointment-details', (req, res) => {
    const { appointmentId } = req.body;
    db.query(`
        SELECT a.*, d.name as doctor_name, d.specialties, c.clinic_name, c.location as clinic_location 
        FROM doctor_appointments a
        JOIN doctors d ON a.doctor_id = d.id
        JOIN doctor_chambers c ON a.chamber_id = c.id
        WHERE a.id = ?
    `, [appointmentId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ success: false, message: 'Appointment not found.' });
        res.json({ success: true, data: results[0] });
    });
});

// --- ডক্টর লগিন ---
app.post('/api/doctor/login', (req, res) => {
    const { username, password } = req.body;
    db.query("SELECT * FROM doctors WHERE username = ? AND password = ? AND status = 'Active'", [username, password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
        if (results.length > 0) res.json({ success: true, message: 'লগিন সফল!', doctorData: results[0] });
        else res.json({ success: false, message: 'ভুল ইউজারনেম/পাসওয়ার্ড।' });
    });
});

// --- ডক্টর ড্যাশবোর্ড ডেটা ---
app.post('/api/doctor/appointments', (req, res) => {
    const { doctorId } = req.body;
    if (!doctorId) return res.status(400).json({ success: false, message: 'ডক্টর আইডি প্রয়োজন।' });
    
    db.query(`
        SELECT a.*, DATE_FORMAT(a.appointment_date, '%Y-%m-%d') as appointment_date_formatted, c.clinic_name, c.location 
        FROM doctor_appointments a
        JOIN doctor_chambers c ON a.chamber_id = c.id
        WHERE a.doctor_id = ?
        ORDER BY a.appointment_date DESC, a.appointment_time ASC
    `, [doctorId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

// --- ডক্টর প্রোফাইল আপডেট ---
app.post('/api/doctor/update-profile', (req, res) => {
    const { doctorId, phone, fee, treated_diseases } = req.body;
    if (!doctorId) return res.status(400).json({ success: false, message: 'ডক্টর আইডি প্রয়োজন।' });
    
    let updateQuery = "UPDATE doctors SET phone = ?, fee = ?, treated_diseases = ? WHERE id = ?";
    let params = [phone, fee, treated_diseases, doctorId];
    
    db.query(updateQuery, params, (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'আপডেট করতে সমস্যা হয়েছে।' });
        
        db.query("SELECT * FROM doctors WHERE id = ?", [doctorId], (err, docs) => {
            if (err || docs.length === 0) return res.json({ success: true, message: 'আপডেট সফল হয়েছে!' });
            res.json({ success: true, message: 'প্রোফাইল আপডেট সফল হয়েছে!', doctorData: docs[0] });
        });
    });
});

// --- সুপার অ্যাডমিন ডক্টর তৈরি ---
app.post('/api/superadmin/create-doctor', (req, res) => {
    const { masterKey, name, email, phone, district, specialties, designation, experience_years, fee, username, password } = req.body;
    if (masterKey !== SUPER_ADMIN_KEY) return res.status(403).json({ success: false, message: 'Access Denied!' });
    
    if(!name || !phone || !district || !specialties || !username || !password) {
        return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য দিন।' });
    }
    
    db.query(`
        INSERT INTO doctors (name, email, phone, district, specialties, designation, experience_years, fee, username, password)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, email || null, phone, district, specialties, designation || null, experience_years || null, fee || 100, username, password], (err, result) => {
        if (err) {
            if(err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'ইউজারনেমটি আগে থেকেই আছে।' });
            return res.status(500).json({ success: false, message: 'ডাক্তার যুক্ত করতে সমস্যা হয়েছে।' });
        }
        res.json({ success: true, message: 'ডাক্তার অ্যাকাউন্ট তৈরি হয়েছে!', doctorId: result.insertId });
    });
});

// --- ডক্টর চেম্বার যোগ করা ---
app.post('/api/doctor/add-chamber', (req, res) => {
    const { doctorId, clinicName, location, visitingDays, startTime, endTime, timePerPatient, maxPatients } = req.body;
    if (!doctorId || !clinicName || !location || !visitingDays || !startTime || !endTime) {
        return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য দিন।' });
    }
    db.query(`
        INSERT INTO doctor_chambers (doctor_id, clinic_name, location, visiting_days, start_time, end_time, time_per_patient_min, max_patients)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [doctorId, clinicName, location, visitingDays, startTime, endTime, timePerPatient || 15, maxPatients || 30], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'চেম্বার যুক্ত করতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'চেম্বার যুক্ত হয়েছে!' });
    });
});

app.post('/api/doctor/update-chamber-status', (req, res) => {
    const { doctorId, chamberId, bookingStatus, maxPatients } = req.body;
    db.query("UPDATE doctor_chambers SET booking_status = ?, max_patients = ? WHERE id = ? AND doctor_id = ?", [bookingStatus, maxPatients, chamberId, doctorId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'আপডেট করতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'আপডেট সফল হয়েছে!' });
    });
});

app.post('/api/doctor/chambers', (req, res) => {
    const { doctorId } = req.body;
    if (!doctorId) return res.status(400).json({ success: false, message: 'ডক্টর আইডি প্রয়োজন।' });
    db.query("SELECT * FROM doctor_chambers WHERE doctor_id = ?", [doctorId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

// --- ডক্টর লিভ/ছুটি ম্যানেজমেন্ট ---
app.post('/api/doctor/leaves', (req, res) => {
    const { doctorId } = req.body;
    db.query("SELECT id, doctor_id, DATE_FORMAT(leave_date, '%Y-%m-%d') as leave_date, reason FROM doctor_leaves WHERE doctor_id = ? ORDER BY leave_date DESC", [doctorId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

app.post('/api/doctor/add-leave', (req, res) => {
    const { doctorId, leaveDate, reason } = req.body;
    db.query("INSERT INTO doctor_leaves (doctor_id, leave_date, reason) VALUES (?, ?, ?)", [doctorId, leaveDate, reason || ''], (err, result) => {
        if (err) {
            if(err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'এই দিনের ছুটি আগে থেকেই যুক্ত করা আছে।' });
            return res.status(500).json({ success: false, message: 'ছুটি যুক্ত করতে সমস্যা হয়েছে।' });
        }
        res.json({ success: true, message: 'ছুটি যুক্ত হয়েছে!' });
    });
});

app.post('/api/doctor/delete-leave', (req, res) => {
    const { doctorId, leaveId } = req.body;
    db.query("DELETE FROM doctor_leaves WHERE id = ? AND doctor_id = ?", [leaveId, doctorId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'ছুটি মুছতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'ছুটি মুছে ফেলা হয়েছে!' });
    });
});

// --- ডক্টর ডেট ওভাররাইড ম্যানেজমেন্ট ---
app.post('/api/doctor/overrides', (req, res) => {
    const { doctorId } = req.body;
    db.query(`
        SELECT o.id, o.chamber_id, DATE_FORMAT(o.override_date, '%Y-%m-%d') as override_date, o.max_patients, o.booking_status, c.clinic_name 
        FROM chamber_date_overrides o 
        JOIN doctor_chambers c ON o.chamber_id = c.id 
        WHERE o.doctor_id = ? ORDER BY o.override_date DESC
    `, [doctorId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে।' });
        res.json({ success: true, data: results });
    });
});

app.post('/api/doctor/save-override', (req, res) => {
    const { doctorId, chamberId, overrideDate, maxPatients, bookingStatus } = req.body;
    db.query(`
        INSERT INTO chamber_date_overrides (doctor_id, chamber_id, override_date, max_patients, booking_status)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE max_patients = VALUES(max_patients), booking_status = VALUES(booking_status)
    `, [doctorId, chamberId, overrideDate, maxPatients || null, bookingStatus || 'Available'], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'সংরক্ষণ করতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'সফলভাবে সংরক্ষণ করা হয়েছে!' });
    });
});

app.post('/api/doctor/delete-override', (req, res) => {
    const { doctorId, overrideId } = req.body;
    db.query("DELETE FROM chamber_date_overrides WHERE id = ? AND doctor_id = ?", [overrideId, doctorId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'মুছতে সমস্যা হয়েছে।' });
        res.json({ success: true, message: 'মুছে ফেলা হয়েছে!' });
    });
});

app.post('/api/doctor/update-appointment-status', (req, res) => {
    const { doctorId, appointmentId, status } = req.body;
    db.query("UPDATE doctor_appointments SET status = ? WHERE id = ? AND doctor_id = ?", [status, appointmentId, doctorId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
        res.json({ success: true, message: 'স্ট্যাটাস আপডেট হয়েছে!' });
    });
});

app.post('/api/doctor/delete-appointment', (req, res) => {
    const { doctorId, appointmentId } = req.body;
    db.query("DELETE FROM doctor_appointments WHERE id = ? AND doctor_id = ?", [appointmentId, doctorId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
        res.json({ success: true, message: 'অ্যাপয়েন্টমেন্ট মুছে ফেলা হয়েছে!' });
    });
});

app.post('/api/doctor/update-chamber-schedule', (req, res) => {
    const { doctorId, chamberId, visitingDays, startTime, endTime, timePerPatient, maxPatients } = req.body;
    db.query(
        "UPDATE doctor_chambers SET visiting_days = ?, start_time = ?, end_time = ?, time_per_patient_min = ?, max_patients = ? WHERE id = ? AND doctor_id = ?",
        [visitingDays, startTime, endTime, timePerPatient, maxPatients, chamberId, doctorId],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
            res.json({ success: true, message: 'শিডিউল সফলভাবে আপডেট হয়েছে!' });
        }
    );
});

app.post('/api/doctor/delete-chamber', (req, res) => {
    const { doctorId, chamberId } = req.body;
    db.query("DELETE FROM doctor_chambers WHERE id = ? AND doctor_id = ?", [chamberId, doctorId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
        res.json({ success: true, message: 'চেম্বার মুছে ফেলা হয়েছে!' });
    });
});

// --- Hospital: Doctor Management ---

// হসপিটালের সাথে লিংকড ডক্টর লিস্ট (with appointment stats)
app.post('/api/hospital/doctors', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    if (!Number.isInteger(hospitalId) || hospitalId <= 0)
        return res.status(400).json({ success: false, message: 'হসপিটাল আইডি সঠিক নয়।' });

    try {
        const doctors = await dbQuery(`
            SELECT
                d.id, d.name, d.email, d.phone, d.district, d.specialties, d.treated_diseases,
                d.designation, d.experience_years, d.fee, d.username, d.status,
                d.max_patients, d.visiting_days, d.created_at,
                (SELECT COUNT(*) FROM doctor_appointments a WHERE a.doctor_id = d.id) AS total_appts,
                (SELECT COUNT(*) FROM doctor_appointments a WHERE a.doctor_id = d.id AND a.status = 'Completed') AS completed_appts,
                (SELECT COUNT(*) FROM doctor_appointments a WHERE a.doctor_id = d.id AND (a.status = 'Confirmed' OR a.status IS NULL)) AS pending_appts
            FROM doctors d
            WHERE d.hospital_id = ? AND d.status = 'Active'
            ORDER BY d.created_at DESC
        `, [hospitalId]);
        res.json({ success: true, data: doctors });
    } catch (err) {
        console.error('Hospital doctors error:', err.message);
        res.status(500).json({ success: false, message: 'ডাক্তার লোড করতে সমস্যা হয়েছে।' });
    }
});

// হসপিটাল থেকে নতুন ডাক্তার যোগ
app.post('/api/hospital/add-doctor', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    const name = normalizeText(req.body.name);
    const specialties = normalizeText(req.body.specialties);
    const designation = toNullableText(req.body.designation);
    const phone = normalizeText(req.body.phone);
    const fee = Number(req.body.fee) || 100;
    const experience_years = req.body.experience_years ? Number(req.body.experience_years) : null;
    const visiting_days = toNullableText(req.body.visiting_days);
    const max_patients = req.body.max_patients ? Number(req.body.max_patients) : null;
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);
    const district = normalizeText(req.body.district) || 'Dhaka';

    if (!Number.isInteger(hospitalId) || !name || !specialties || !phone || !username || !password)
        return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য পূরণ করুন।' });

    try {
        const result = await dbQuery(`
            INSERT INTO doctors (hospital_id, name, phone, district, specialties, designation,
                experience_years, fee, max_patients, visiting_days, username, password, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
        `, [hospitalId, name, phone, district, specialties, designation,
            experience_years, fee, max_patients, visiting_days, username, password]);
        res.json({ success: true, message: 'ডাক্তার সফলভাবে যোগ হয়েছে!', doctorId: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(400).json({ success: false, message: 'এই ইউজারনেম আগে থেকেই আছে।' });
        console.error('Add hospital doctor error:', err.message);
        res.status(500).json({ success: false, message: 'ডাক্তার যোগ করতে সমস্যা হয়েছে।' });
    }
});

// ডক্টর ডিটেইল (hospital-specific)
app.post('/api/hospital/doctor-detail', async (req, res) => {
    const doctorId = Number(req.body.doctorId);
    const hospitalId = Number(req.body.hospitalId);

    if (!Number.isInteger(doctorId) || !Number.isInteger(hospitalId))
        return res.status(400).json({ success: false, message: 'আইডি সঠিক নয়।' });

    try {
        const rows = await dbQuery(`
            SELECT d.*, dc.id AS chamber_id, dc.clinic_name, dc.location AS chamber_location,
                dc.visiting_days AS chamber_days, dc.start_time, dc.end_time, dc.time_per_patient_min, dc.max_patients AS chamber_max
            FROM doctors d
            LEFT JOIN doctor_chambers dc ON dc.doctor_id = d.id
            WHERE d.id = ? AND d.hospital_id = ?
            LIMIT 1
        `, [doctorId, hospitalId]);

        if (!rows.length) return res.status(404).json({ success: false, message: 'ডাক্তার পাওয়া যায়নি।' });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে।' });
    }
});

// --- Hospital: Appointment Management ---

// তারিখ অনুযায়ী এই হসপিটালের অ্যাপয়েন্টমেন্ট
app.post('/api/hospital/appointments-by-date', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    const date = normalizeText(req.body.date);
    const doctorId = req.body.doctorId ? Number(req.body.doctorId) : null;

    if (!Number.isInteger(hospitalId) || !date)
        return res.status(400).json({ success: false, message: 'তথ্য সঠিক নয়।' });

    try {
        let query = `
            SELECT a.*, d.name AS doctor_name, d.specialties,
                c.clinic_name, c.location AS clinic_location
            FROM doctor_appointments a
            JOIN doctors d ON a.doctor_id = d.id
            LEFT JOIN doctor_chambers c ON a.chamber_id = c.id
            WHERE d.hospital_id = ? AND a.appointment_date = ?
        `;
        const params = [hospitalId, date];
        if (doctorId) { query += ' AND a.doctor_id = ?'; params.push(doctorId); }
        query += ' ORDER BY a.appointment_time ASC';

        const results = await dbQuery(query, params);
        res.json({ success: true, data: results });
    } catch (err) {
        console.error('Appointments by date error:', err.message);
        res.status(500).json({ success: false, message: 'অ্যাপয়েন্টমেন্ট লোড করতে সমস্যা হয়েছে।' });
    }
});

// অফলাইন রোগী যোগ
app.post('/api/hospital/add-offline-appointment', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    const doctorId = req.body.doctorId ? Number(req.body.doctorId) : null;
    const patientName = normalizeText(req.body.patientName);
    const patientPhone = normalizeText(req.body.patientPhone);
    const patientAge = Number(req.body.patientAge);
    const patientGender = normalizeText(req.body.patientGender);
    const patientProblem = toNullableText(req.body.patientProblem);
    const appointmentDate = normalizeText(req.body.appointmentDate);

    if (!Number.isInteger(hospitalId) || !patientName || !patientPhone || !patientAge || !patientGender || !appointmentDate)
        return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য পূরণ করুন।' });

    const cleanPhone = validateAndNormalizeBDPhone(patientPhone);
    if (!cleanPhone) return res.status(400).json({ success: false, message: 'সঠিক মোবাইল নম্বর দিন।' });

    try {
        // Get next serial for this doctor+date (or hospital+date if no doctor)
        let serialQuery, serialParams;
        if (doctorId) {
            serialQuery = 'SELECT COALESCE(MAX(serial_number), 0) + 1 AS next_serial FROM doctor_appointments WHERE doctor_id = ? AND appointment_date = ?';
            serialParams = [doctorId, appointmentDate];
        } else {
            serialQuery = 'SELECT 1 AS next_serial';
            serialParams = [];
        }
        const serialRes = await dbQuery(serialQuery, serialParams);
        const serialNumber = serialRes[0].next_serial;

        // Get or auto-create a default chamber when the doctor has none
        // chamber_id is NOT NULL in doctor_appointments table, so we must have a valid id
        let chamberId = null;
        if (doctorId) {
            const chambers = await dbQuery('SELECT id FROM doctor_chambers WHERE doctor_id = ? LIMIT 1', [doctorId]);
            if (chambers.length) {
                chamberId = chambers[0].id;
            } else {
                // Doctor exists but has no chamber — auto-create one using the doctor's own info
                const doctorRows = await dbQuery('SELECT name, district FROM doctors WHERE id = ? LIMIT 1', [doctorId]);
                const doctorName = doctorRows.length ? doctorRows[0].name : 'Doctor';
                const doctorDistrict = doctorRows.length ? doctorRows[0].district : 'Bangladesh';
                const newChamber = await dbQuery(
                    `INSERT INTO doctor_chambers
                        (doctor_id, clinic_name, location, visiting_days, start_time, end_time, time_per_patient_min, max_patients)
                     VALUES (?, ?, ?, 'Saturday,Sunday,Monday,Tuesday,Wednesday,Thursday', '09:00:00', '21:00:00', 15, 60)`,
                    [doctorId, `${doctorName} Clinic (Default)`, doctorDistrict]
                );
                chamberId = newChamber.insertId;
                console.log(`Auto-created default chamber ${chamberId} for doctor ${doctorId}`);
            }
        }

        // Calculate time — simple: 9:00 AM + (serial-1)*15min if no chamber
        const startMin = 9 * 60;
        const apptMin = startMin + (serialNumber - 1) * 15;
        const formatMin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
        const appointmentTime = formatMin(apptMin);
        const reportingTime = formatMin(apptMin - 10);

        await dbQuery(`
            INSERT INTO doctor_appointments
                (doctor_id, chamber_id, patient_name, patient_phone, patient_age, patient_gender,
                 patient_problem, appointment_date, appointment_time, reporting_time,
                 serial_number, payment_method, trx_id, payment_amount, status, appointment_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline', 'OFFLINE', 0, 'Confirmed', 'offline')
        `, [doctorId || null, chamberId, patientName, cleanPhone, patientAge, patientGender,
            patientProblem, appointmentDate, appointmentTime, reportingTime, serialNumber]);

        res.json({ success: true, message: 'অফলাইন রোগী যোগ হয়েছে!', serialNumber });
    } catch (err) {
        console.error('Offline appointment error:', err.message);
        res.status(500).json({ success: false, message: 'রোগী যোগ করতে সমস্যা হয়েছে।' });
    }
});

// অ্যাপয়েন্টমেন্ট স্ট্যাটাস আপডেট
app.post('/api/hospital/update-appointment', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    const appointmentId = Number(req.body.appointmentId);
    const status = normalizeText(req.body.status);

    if (!['Confirmed', 'Completed', 'Cancelled'].includes(status))
        return res.status(400).json({ success: false, message: 'স্ট্যাটাস সঠিক নয়।' });

    try {
        // Verify this appointment belongs to this hospital's doctor
        await dbQuery(`
            UPDATE doctor_appointments a
            JOIN doctors d ON a.doctor_id = d.id
            SET a.status = ?
            WHERE a.id = ? AND d.hospital_id = ?
        `, [status, appointmentId, hospitalId]);
        res.json({ success: true, message: 'স্ট্যাটাস আপডেট হয়েছে।' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'আপডেট করতে সমস্যা হয়েছে।' });
    }
});

// --- Hospital: Blood Requests ---

// হসপিটালের নিজস্ব ব্লাড রিকোয়েস্ট হিস্ট্রি
app.post('/api/hospital/blood-requests', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    if (!Number.isInteger(hospitalId) || hospitalId <= 0)
        return res.status(400).json({ success: false, message: 'হসপিটাল আইডি সঠিক নয়।' });

    try {
        // Get blood requests sent by this hospital
        const requests = await dbQuery(`
            SELECT br.*,
                (SELECT COUNT(*) FROM donor_requests dr WHERE dr.request_id = br.id AND dr.status = 'Accepted') AS accepted_count
            FROM blood_requests br
            WHERE br.hospital_name = (SELECT name FROM hospitals WHERE id = ? LIMIT 1)
            ORDER BY br.created_at DESC
            LIMIT 30
        `, [hospitalId]);

        // For each request, get accepted donors' contact info
        for (const req of requests) {
            const donors = await dbQuery(`
                SELECT d.name, d.phone
                FROM donor_requests dr
                JOIN donors d ON dr.donor_id = d.id
                WHERE dr.request_id = ? AND dr.status = 'Accepted'
            `, [req.id]);
            req.accepted_donors = donors;
            req.bags = req.bags_needed || 1;
            if (req.tracking_token) {
                req.tracking_url = `/request-status?token=${req.tracking_token}`;
            }
        }

        res.json({ success: true, data: requests });
    } catch (err) {
        console.error('Hospital blood requests error:', err.message);
        res.status(500).json({ success: false, message: 'রিকোয়েস্ট লোড করতে সমস্যা হয়েছে।' });
    }
});

// হসপিটাল থেকে ব্লাড রিকোয়েস্ট পাঠানো (bags support সহ)
app.post('/api/hospital/send-blood-request', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    const bloodGroup = normalizeText(req.body.bloodGroup);
    const bags = Math.max(1, parseInt(req.body.bags) || 1);
    const neededTime = normalizeText(req.body.neededTime);
    const patientDisease = normalizeText(req.body.patientDisease);
    const contactNumber = normalizeText(req.body.contactNumber);
    const hospitalName = normalizeText(req.body.hospitalName);
    const location = normalizeText(req.body.location);
    const district = normalizeText(req.body.district) || extractDistrict(location);
    const latitude = toRequiredCoordinate(req.body.latitude);
    const longitude = toRequiredCoordinate(req.body.longitude);

    if (!Number.isInteger(hospitalId) || !ALLOWED_BLOOD_GROUPS.includes(bloodGroup) || !neededTime || !patientDisease || !hospitalName)
        return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য পূরণ করুন।' });

    const cleanPhone = validateAndNormalizeBDPhone(contactNumber);
    if (!cleanPhone) return res.status(400).json({ success: false, message: 'সঠিক মোবাইল নম্বর দিন।' });

    // We send `bags` number of parallel/serial requests
    // For simplicity: create one blood_request and queue `bags` worth of donors
    const requestSeed = { blood_group: bloodGroup, location, district, latitude: latitude || 0, longitude: longitude || 0 };

    try {
        const sortedDonors = await findAvailableDonorsInDistrict(requestSeed);
        const trackingToken = require('crypto').randomBytes(24).toString('hex');

        const result = await dbQuery(`
            INSERT INTO blood_requests
                (blood_group, location, district, upazila, latitude, longitude,
                 hospital_name, needed_time, patient_disease, contact_number,
                 tracking_token, bags_needed)
            VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [bloodGroup, location || hospitalName, district, latitude || null, longitude || null,
            hospitalName, neededTime, patientDisease, cleanPhone, trackingToken, bags]);

        const requestId = result.insertId;

        // Queue donors
        for (let i = 0; i < sortedDonors.length; i++) {
            const donor = sortedDonors[i];
            const distKm = donor.distance_km !== null ? Number(donor.distance_km.toFixed(2)) : null;
            await dbQuery(
                'INSERT INTO donor_requests (request_id, donor_id, notify_order, distance_km) VALUES (?, ?, ?, ?)',
                [requestId, donor.id, i + 1, distKm]
            );
        }

        await activateNextDonor(requestId);

        res.json({
            success: true,
            message: sortedDonors.length > 0
                ? `${sortedDonors.length} জন ডোনারকে নোটিফিকেশন পাঠানো হয়েছে।`
                : 'এই মুহূর্তে কোনো Available ডোনার নেই।',
            requestId,
            trackingToken,
            donorCount: sortedDonors.length
        });
    } catch (err) {
        console.error('Hospital send-blood-request error:', err.message);
        res.status(500).json({ success: false, message: 'রিকোয়েস্ট পাঠাতে সমস্যা হয়েছে।' });
    }
});

// --- Hospital: Bed Management ---

app.post('/api/hospital/update-beds-full', async (req, res) => {
    const hospitalId = Number(req.body.hospitalId);
    const icu = Number(req.body.icu) || 0;
    const emergency = Number(req.body.emergency) || 0;
    const normal = Number(req.body.normal) || 0;
    const icu_total = Number(req.body.icu_total) || icu;
    const em_total = Number(req.body.em_total) || emergency;
    const normal_total = Number(req.body.normal_total) || normal;

    if (!Number.isInteger(hospitalId) || hospitalId <= 0)
        return res.status(400).json({ success: false, message: 'হসপিটাল আইডি সঠিক নয়।' });

    if (!isNonNegativeInteger(icu) || !isNonNegativeInteger(emergency) || !isNonNegativeInteger(normal))
        return res.status(400).json({ success: false, message: 'বেড সংখ্যা সঠিক নয়।' });

    try {
        await dbQuery(`
            UPDATE hospitals
            SET icu_available = ?, emergency_bed_available = ?, normal_bed_available = ?,
                icu_total = ?, em_total = ?, normal_total = ?
            WHERE id = ?
        `, [icu, emergency, normal, icu_total, em_total, normal_total, hospitalId]);
        res.json({ success: true, message: 'বেড তথ্য আপডেট হয়েছে!' });
    } catch (err) {
        console.error('Update beds full error:', err.message);
        res.status(500).json({ success: false, message: 'আপডেট করতে সমস্যা হয়েছে।' });
    }
});

// --- Public: Medical Centers ---


// --- Change Password ---

// Hospital change password
app.post('/api/hospital/change-password', async (req, res) => {
    const { hospitalId, currentPassword, newPassword } = req.body;
    if (!hospitalId || !currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'সব তথ্য পূরণ করুন।' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }
    try {
        const [rows] = await db.promise().query('SELECT password FROM hospitals WHERE id = ?', [hospitalId]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'হাসপাতাল পাওয়া যায়নি।' });
        if (rows[0].password !== currentPassword) {
            return res.status(401).json({ success: false, message: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
        }
        await db.promise().query('UPDATE hospitals SET password = ? WHERE id = ?', [newPassword, hospitalId]);
        res.json({ success: true, message: 'পাসওয়ার্ড পরিবর্তন হয়েছে।' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
    }
});

// Donor change password
app.post('/api/donor/change-password', async (req, res) => {
    const { donorId, currentPassword, newPassword } = req.body;
    if (!donorId || !currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'সব তথ্য পূরণ করুন।' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }
    try {
        const [rows] = await db.promise().query('SELECT password FROM donors WHERE id = ?', [donorId]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'ডোনার পাওয়া যায়নি।' });
        if (rows[0].password !== currentPassword) {
            return res.status(401).json({ success: false, message: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
        }
        await db.promise().query('UPDATE donors SET password = ? WHERE id = ?', [newPassword, donorId]);
        res.json({ success: true, message: 'পাসওয়ার্ড পরিবর্তন হয়েছে।' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
    }
});

// Doctor change password
app.post('/api/doctor/change-password', async (req, res) => {
    const { doctorId, currentPassword, newPassword } = req.body;
    if (!doctorId || !currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'সব তথ্য পূরণ করুন।' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }
    try {
        const [rows] = await db.promise().query('SELECT password FROM doctors WHERE id = ?', [doctorId]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'ডাক্তার পাওয়া যায়নি।' });
        if (rows[0].password !== currentPassword) {
            return res.status(401).json({ success: false, message: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
        }
        await db.promise().query('UPDATE doctors SET password = ? WHERE id = ?', [newPassword, doctorId]);
        res.json({ success: true, message: 'পাসওয়ার্ড পরিবর্তন হয়েছে।' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'সার্ভার এরর।' });
    }
});


app.get('/api/medical-centers', async (req, res) => {
    try {
        const centers = await dbQuery(`
            SELECT id, name, location, address, phone, latitude, longitude,
                icu_available, emergency_bed_available, normal_bed_available,
                icu_total, em_total, normal_total
            FROM hospitals
            WHERE status = 'Active'
            ORDER BY name ASC
        `);
        res.json({ success: true, data: centers });
    } catch (err) {
        console.error('Medical centers error:', err.message);
        res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে।' });
    }
});


// --- Server Startup ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
