// ============================================================
//   HOSPITAL DASHBOARD — নতুন API Endpoints
//   এই কোডটি server.js-এ যোগ করতে হবে
//   অবস্থান: "app.listen(PORT, ...)" এর ঠিক আগে
// ============================================================

// ── Schema additions (setupSchema() ফাংশনের ভেতরে runSchemaQuery দিয়ে যোগ করুন) ──
// নিচের লাইনগুলো setupSchema() এর শেষ দিকে forEach block-এ যোগ করুন:
//
//   "ALTER TABLE hospitals ADD COLUMN normal_bed_available INT NOT NULL DEFAULT 0 AFTER emergency_bed_available",
//   "ALTER TABLE hospitals ADD COLUMN icu_total INT NOT NULL DEFAULT 0 AFTER normal_bed_available",
//   "ALTER TABLE hospitals ADD COLUMN em_total INT NOT NULL DEFAULT 0 AFTER icu_total",
//   "ALTER TABLE hospitals ADD COLUMN normal_total INT NOT NULL DEFAULT 0 AFTER em_total",
//   "ALTER TABLE doctors ADD COLUMN hospital_id INT NULL AFTER id",
//   "ALTER TABLE doctors ADD COLUMN max_patients INT NULL AFTER treated_diseases",
//   "ALTER TABLE doctors ADD COLUMN visiting_days VARCHAR(255) NULL AFTER max_patients",
//   "ALTER TABLE doctor_appointments ADD COLUMN appointment_type ENUM('online','offline') NOT NULL DEFAULT 'online' AFTER status",


// ════════════════════════════════════════════════════════════
//   1. HOSPITAL — Doctor Management
// ════════════════════════════════════════════════════════════

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


// ════════════════════════════════════════════════════════════
//   2. HOSPITAL — Appointment Management
// ════════════════════════════════════════════════════════════

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

        // Use dummy chamber if no chamber
        let chamberId = null;
        if (doctorId) {
            const chambers = await dbQuery('SELECT id FROM doctor_chambers WHERE doctor_id = ? LIMIT 1', [doctorId]);
            if (chambers.length) chamberId = chambers[0].id;
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


// ════════════════════════════════════════════════════════════
//   3. HOSPITAL — Blood Requests (with bag count)
// ════════════════════════════════════════════════════════════

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
                req.tracking_url = `/request-status.html?token=${req.tracking_token}`;
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


// ════════════════════════════════════════════════════════════
//   4. HOSPITAL — Bed Management (Full: ICU + EM + Normal)
// ════════════════════════════════════════════════════════════

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


// ════════════════════════════════════════════════════════════
//   5. PUBLIC — Medical Centers (hospitals with full bed info)
// ════════════════════════════════════════════════════════════

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