// Centralized Language Switcher for LifeLine
// Default Language: Bengali ('bn'), target switch to English ('en')

(function() {
    // Styles for the premium toggle button and translated UI elements
    const style = document.createElement('style');
    style.innerHTML = `
        .lang-switcher-capsule {
            position: fixed;
            bottom: 25px;
            right: 25px;
            z-index: 10000;
            background: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(226, 232, 240, 0.8);
            border-radius: 9999px;
            padding: 4px;
            display: flex;
            align-items: center;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            font-family: 'Inter', system-ui, sans-serif;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            user-select: none;
        }
        .lang-switcher-capsule:hover {
            transform: translateY(-2px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
            border-color: #3b82f6;
        }
        .lang-switcher-btn {
            border: none;
            background: transparent;
            padding: 6px 12px;
            border-radius: 9999px;
            cursor: pointer;
            color: #64748b;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
        }
        .lang-switcher-btn.active {
            background: #2563eb;
            color: #ffffff;
            box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2), 0 2px 4px -2px rgba(37, 99, 235, 0.2);
        }
        /* Top Navigation integration support */
        .nav-lang-switcher {
            display: inline-flex;
            align-items: center;
            margin-right: 15px;
            background: rgba(0, 0, 0, 0.05);
            border-radius: 9999px;
            padding: 2px;
            vertical-align: middle;
        }
        .nav-lang-btn {
            background: transparent;
            border: none;
            padding: 4px 8px;
            border-radius: 9999px;
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            color: inherit;
            opacity: 0.6;
            transition: all 0.2s;
        }
        .nav-lang-btn.active {
            background: var(--primary, #2563eb);
            color: #fff !important;
            opacity: 1;
        }
        /* Style fixes for English layouts to look neat */
        [lang="en"] {
            font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        }
    `;
    document.head.appendChild(style);

    // Core Translation Dictionary (Bengali -> English)
    const dictionary = {
        // Navigation and Header
        "🩺 ডাক্তার সিরিয়াল": "🩺 Doctor Serial",
        "🩺 ডাক্তার সিরিয়াল": "🩺 Doctor Serial",
        "🏥 Medical Centers": "🏥 Medical Centers",
        "🏥 Medical Centers পেজ দেখুন": "🏥 View Medical Centers",
        "লগইন / রেজিস্টার": "Login / Register",
        "আবেদন করুন": "Apply Now",
        "হোম": "Home",
        "ড্যাশবোর্ড": "Dashboard",
        "লগআউট": "Logout",
        "ডোনার পোর্টাল": "Donor Portal",
        "ডাক্তার পোর্টাল": "Doctor Portal",
        "হাসপাতাল পোর্টাল": "Hospital Portal",
        "সুপার অ্যাডমিন পোর্টাল": "Super Admin Portal",
        "← হোমপেজে ফিরে যান": "← Back to Homepage",
        "← হোমে ফিরুন": "← Back to Home",
        "ফিরে যান": "Go Back",

        // index.html (Homepage)
        "LifeLine — জরুরি রক্ত ও হাসপাতাল সেবা": "LifeLine — Emergency Blood & Hospital Services",
        "LifeLine — বাংলাদেশে জরুরি রক্তের জন্য আবেদন করুন এবং কাছের হাসপাতালের বেড খুঁজুন।": "LifeLine — Apply for emergency blood and find nearby hospital beds in Bangladesh.",
        "বাংলাদেশের জরুরি স্বাস্থ্য সেবা প্ল্যাটফর্ম": "Emergency Healthcare Service Platform in Bangladesh",
        "জরুরি মুহূর্তে": "In Emergency",
        "আমরা আছি পাশে": "We Are by Your Side",
        "রক্তের প্রয়োজন? নাকি হাসপাতালে বেড খুঁজছেন?": "Need blood? Or looking for hospital beds?",
        "LifeLine দিয়ে মুহূর্তের মধ্যে সাহায্য পান।": "Get instant help with LifeLine.",
        "নিবন্ধিত ডোনার": "Registered Donors",
        "হাসপাতাল": "Hospitals",
        "অ্যালার্ট পাঠানো": "Alerts Sent",
        "জরুরি রক্তের আবেদন": "Emergency Blood Request",
        "এক ক্লিকে আপনার কাছের সকল রক্তদাতাদের কাছে ইমার্জেন্সি অ্যালার্ট পাঠান। দ্রুত সাড়া পান।": "Send emergency alerts to all nearby donors in one click. Get fast responses.",
        "লাইভ হাসপাতাল বেড স্ট্যাটাস": "Live Hospital Bed Status",
        "লাইভ লাইভ হাসপাতাল বেড স্ট্যাটাস": "Live Hospital Bed Status",
        "কাছের হাসপাতালে ICU ও ইমার্জেন্সি বেডের লাইভ তথ্য দেখুন। সঠিক হাসপাতাল বেছে নিন।": "Check live ICU & emergency beds in nearby hospitals. Choose the right one.",
        "বেড দেখুন": "Check Beds",
        "ডাক্তার অ্যাপয়েন্টমেন্ট": "Doctor Appointment",
        "আপনার জেলার সেরা ডাক্তারদের তালিকা দেখুন এবং সহজেই ঘরে বসে অনলাইনে সিরিয়াল বুক করুন।": "See the best doctors in your district and book appointment serials online from home.",
        "সিরিয়াল নিন": "Get Serial",
        "📝 ডোনার হিসেবে নিবন্ধন করুন": "📝 Register as Donor",
        "🩺 ডাক্তার অ্যাপয়েন্টমেন্ট নিন": "🩺 Book Doctor Serial",
        "🔍 আবেদনের অবস্থা দেখুন": "🔍 View Request Status",
        "🔐 ড্যাশবোর্ডে প্রবেশ করুন": "🔐 Login to Dashboard",
        "কিভাবে কাজ করে": "How It Works",
        "মাত্র ৩টি ধাপে সাহায্য পান": "Get Help in Just 3 Steps",
        "১": "1",
        "আপনার প্রয়োজন বেছে নিন": "Choose Your Need",
        "রক্ত দরকার নাকি হাসপাতালের বেড — সেই অনুযায়ী সেকশন নির্বাচন করুন।": "Select the section according to whether you need blood or a hospital bed.",
        "২": "2",
        "তথ্য পূরণ করুন": "Fill Out Info",
        "রক্তের গ্রুপ, অবস্থান ও প্রয়োজনীয় তথ্য দিন। মাত্র এক মিনিটেই সম্পন্ন হবে।": "Provide blood group, location, and details. Takes less than a minute.",
        "৩": "3",
        "সাহায্য পান": "Get Help",
        "সিস্টেম স্বয়ংক্রিয়ভাবে কাছের ডোনার বা হাসপাতালের তথ্য আপনার কাছে পৌঁছে দেবে।": "The system automatically matches and connects you with nearby donors or hospitals.",
        "© ২০২৬ LifeLine — জরুরি রক্ত ও হাসপাতাল সেবা | বাংলাদেশ 🇧🇩": "© 2026 LifeLine — Emergency Blood & Hospital Services | Bangladesh 🇧🇩",

        // login.html & registration (apply.html)
        "🩸 LifeLine লগইন": "🩸 LifeLine Login",
        "সিকিউর ড্যাশবোর্ড প্যানেল": "Secure Dashboard Panel",
        "লগইন": "Login",
        "রেজিস্ট্রেশন": "Registration",
        "ইমেইল / ইউজারনেম": "Email / Username",
        "আপনার ইমেইল বা ইউজারনেম দিন": "Enter your email or username",
        "পাসওয়ার্ড বা মাস্টার-কি": "Password or Master-Key",
        "লগইন করুন": "Login",
        "নতুন অ্যাকাউন্টের জন্য আবেদন করুন": "Apply for New Account",
        "📝 ড্যাশবোর্ড রেজিস্ট্রেশন": "📝 Dashboard Registration",
        "ডোনার বা হসপিটাল হিসেবে লাইফলাইন প্ল্যাটফর্মে আবেদন করুন": "Apply as a Donor or Hospital on the LifeLine Platform",
        "অ্যাকাউন্ট টাইপ": "Account Type",
        "রক্তদাতা (Donor)": "Blood Donor (Donor)",
        "মেডিকেল / হসপিটাল": "Medical Center / Hospital",
        "নাম": "Name",
        "পূর্ণ নাম / প্রতিষ্ঠানের নাম": "Full Name / Institution Name",
        "ইমেইল": "Email",
        "পাসওয়ার্ড": "Password",
        "পাসওয়ার্ড": "Password",
        "কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড": "Minimum 6 characters password",
        "কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড": "Minimum 6 characters password",
        "ফোন / WhatsApp": "Phone / WhatsApp",
        "জেলা ও উপজেলা": "District & Upazila",
        "জেলা": "District",
        "জেলা বেছে নিন": "Select District",
        "জেলা নির্বাচন করুন": "Select District",
        "উপজেলা": "Upazila",
        "উপজেলা বেছে নিন": "Select Upazila",
        "উপজেলা নির্বাচন করুন": "Select Upazila",
        "রক্তের গ্রুপ": "Blood Group",
        "রক্তের গ্রুপ বেছে নিন": "Select Blood Group",
        "পেশা": "Occupation",
        "ছাত্র / চাকরি...": "Student / Job / Business...",
        "কয়বার রক্ত দিয়েছেন": "Times Donated",
        "কয়বার রক্ত দিয়েছেন": "Times Donated",
        "শেষ রক্তদানের তারিখ": "Last Donation Date",
        "বয়স": "Age",
        "যেমন: 24": "e.g. 24",
        "স্বাস্থ্য/নোট": "Health Notes / Directives",
        "কোনো বিশেষ রোগ/নোট থাকলে": "Any special illnesses or notes",
        "দায়িত্বপ্রাপ্ত ব্যক্তি": "Authorized Representative",
        "দায়িত্বপ্রাপ্ত ব্যক্তি": "Authorized Representative",
        "লাইসেন্স / রেজিস্ট্রেশন নম্বর": "License / Registration Number",
        "রেজিস্ট্রেশন আবেদন জমা দিন": "Submit Registration Application",
        "ইতিমধ্যে অ্যাকাউন্ট আছে? লগইন করুন": "Already have an account? Login",
        "ম্যাপ থেকে সঠিক লোকেশন দিন": "Set Location from Map",
        "🔍 জায়গা সার্চ করুন...": "🔍 Search location...",
        "📍 আমার অবস্থান খুঁজুন": "📍 Find My Location",
        "📍 ম্যাপে ক্লিক করে অথবা সার্চ করে লোকেশন সিলেক্ট করুন।": "📍 Click map or search to select location.",

        // blood-request.html
        "জরুরি রক্তের আবেদন — LifeLine": "Emergency Blood Request — LifeLine",
        "ইমার্জেন্সি রক্তের অনুরোধ": "Emergency Blood Request",
        "নিচের ফর্মটি পূরণ করুন — কাছের সকল ডোনারদের কাছে অটোমেটিক অ্যালার্ট যাবে।": "Fill this form - nearby available donors will receive automatic alerts.",
        "🏥 মেডিকেল / হাসপাতালের নাম": "🏥 Medical Center / Hospital Name",
        "যেমন: ঢাকা মেডিকেল কলেজ হাসপাতাল": "e.g. Dhaka Medical College Hospital",
        "⏰ কখন রক্ত লাগবে?": "⏰ When is blood needed?",
        "যেমন: আজ বিকেল ৪টা": "e.g. Today 4:00 PM",
        "🩺 রোগীর ধরন / রোগ": "🩺 Patient Diagnosis / Illness",
        "যেমন: সিজার, এক্সিডেন্ট": "e.g. Caesarean, Accident",
        "যেমন: সিজার, দুর্ঘটনা": "e.g. Caesarean, Accident",
        "📞 যোগাযোগের মোবাইল নম্বর": "📞 Contact Mobile Number",
        "০১৭XXXXXXXX": "017XXXXXXXX",
        "📍 ম্যাপে সঠিক অবস্থান চিহ্নিত করুন": "📍 Mark Exact Location on Map",
        "🔍 জায়গা খুঁজুন...": "🔍 Search place...",
        "আমার অবস্থান": "My Location",
        "ম্যাপে ক্লিক করে অবস্থান সেট করুন": "Click map to set location",
        "🚨 ইমার্জেন্সি অ্যালার্ট পাঠান": "🚨 Send Emergency Alert",
        "⚡ আপনার আবেদন জমা হওয়ার সাথে সাথে কাছের সকল উপলব্ধ ডোনারদের কাছে পুশ নোটিফিকেশন পাঠানো হবে।": "⚡ Push alerts will instantly notify available nearby donors upon submission.",
        "সব তথ্য সঠিকভাবে পূরণ করুন": "Please fill all details correctly",

        // request-status.html
        "রক্তের রিকোয়েস্ট ট্র্যাকিং — LifeLine": "Blood Request Tracking — LifeLine",
        "রিকোয়েস্ট ট্র্যাকিং": "Request Tracking",
        "রক্তের অনুরোধ": "Blood Request",
        "পেন্ডিং": "Pending",
        "সম্পন্ন": "Completed",
        "সক্রিয় অনুরোধসমূহ": "Active Requests",
        "কোনো সক্রিয় অনুরোধ নেই": "No active requests found",
        "কপি": "Copy",
        "রক্তের গ্রুপ:": "Blood Group:",
        "লোকেশন:": "Location:",
        "হাসপাতাল:": "Hospital:",
        "время বাকি:": "Time remaining:",
        "যোগাযোগ:": "Contact:",
        "সহায়তা সাড়া:": "Responded:",
        "🔍 আবেদনের অবস্থা দেখুন": "🔍 Track Request Status",
        "রিকোয়েস্ট ডিটেইলস": "Request Details",

        // doctors.html (Doctors search)
        "বিশেষজ্ঞ ডাক্তার খুঁজুন ও অ্যাপয়েন্টমেন্ট নিন": "Find Specialist Doctors & Book Appointment",
        "নাম দিয়ে খুঁজুন...": "Search by name...",
        "সব জেলা": "All Districts",
        "সব ক্যাটাগরি": "All Specialties",
        "নিকটতম থেকে দূরতম ক্রমে": "Nearest to Farthest",
        "ফিল্টার মুছুন": "Clear Filters",
        "আপডেট করুন": "Update",
        "অভিজ্ঞতা (বছর)": "Experience (Years)",
        "অভিজ্ঞতা:": "Experience:",
        "ভিজিট ফি (৳)": "Visit Fee (৳)",
        "যেমন: হৃদরোগ, উচ্চ রক্তচাপ, ডায়াবেটিস": "e.g. Heart disease, hypertension, diabetes",
        "যেমন: হৃদরোগ, উচ্চ রক্তচাপ, ডায়াবেটিস": "e.g. Heart disease, hypertension, diabetes",
        "ডাক্তারদের তথ্য, স্লট ও অ্যাপয়েন্টমেন্ট পরিচালনা": "Manage Doctors, Slots & Appointments",
        "ডাক্তার: ": "Doctor: ",
        "চেম্বার: ": "Chamber: ",
        "সময়: ": "Time: ",
        "দিন: ": "Days: ",
        "ঠিকানা: ": "Address: ",
        "রোগী দেখার ক্যাপাসিটি:": "Patient Capacity:",
        "সর্বোচ্চ ক্যাপাসিটি (প্রতিদিন)": "Max Capacity (Daily)",
        "বুকিং স্ট্যাটাস *": "Booking Status *",
        "বুকিং সফল হয়েছে!": "Booking Successful!",
        "সিরিয়াল বুক করুন (৳${doc.fee})": "Book Serial (৳${doc.fee})",
        "কোনো ডাক্তার পাওয়া যায়নি": "No doctors found matching filters",

        // doctor-booking.html (Patient detail & booking)
        "ডাক্তারের তথ্য": "Doctor Information",
        "চেম্বার:": "Chamber:",
        "দিন:": "Days:",
        "সময়:": "Time:",
        "ঠিকানা:": "Address:",
        "মোট ফি:": "Total Fee:",
        "১০০ টাকা পেমেন্ট করুন ও সিরিয়াল নিন": "Pay ৳100 & Book Serial",
        "রোগীর তথ্য দিন": "Patient Information",
        "রোগীর নাম *": "Patient Name *",
        "রোগীর নাম:": "Patient Name:",
        "ফোন নাম্বার *": "Phone Number *",
        "ইমেইল (ঐচ্ছিক)": "Email (Optional)",
        "বয়স *": "Age *",
        "লিঙ্গ *": "Gender *",
        "নির্বাচন করুন": "Select Gender",
        "পুরুষ": "Male",
        "মহিলা": "Female",
        "অন্যান্য": "Other",
        "সমস্যা সংক্ষেপে লিখুন *": "Briefly Describe Illness *",
        "অ্যাপয়েন্টমেন্টের তারিখ * (ক্যালেন্ডার থেকে নির্বাচন করুন)": "Appointment Date * (Select from Calendar)",
        "তারিখ নির্বাচন করুন...": "Select date...",
        "আপনার সিরিয়াল নির্বাচন করুন *": "Select Your Serial *",
        "১০০ টাকা অ্যাডভান্স": "৳100 Advance",
        "অ্যাপয়েন্টমেন্ট নিশ্চিত করতে": "To confirm appointment",
        "অ্যাডভান্স পেমেন্ট:": "Advance Payment:",
        "এবং বাকি ৳": "and the remaining ৳",
        "চেম্বারে গিয়ে দিতে হবে।": "must be paid at the chamber.",
        "পেমেন্ট সংক্রান্ত তথ্য": "Payment Information",
        "বাকি টাকা (Due):": "Due Amount:",
        "লোকেশন পাওয়া যায়নি। অনুগ্রহ করে ম্যাপে ম্যানুয়ালি ক্লিক করুন।": "Location not found. Please click the map manually.",
        "লোড হচ্ছে...": "Loading...",
        "তারিখ এবং সিরিয়াল নির্বাচন করুন।": "Please select date and serial.",
        "রোগীর নাম": "Patient Name",
        "পেশা": "Occupation",
        "রোগীর সমস্যা / কারণ": "Patient Illness / Reason",
        "সিরিয়াল নম্বর:": "Serial Number:",
        "রিপোর্টিং সময় (চেম্বারে উপস্থিতির সময়):": "Reporting Time (Time to arrive at Chamber):",
        "ডাক্তার দেখার সময় (আনুমানিক):": "Estimated Visit Time:",
        "রশিদ ডাউনলোড করুন (PDF)": "Download Receipt (PDF)",
        "অপেক্ষমান": "Waiting",
        "দেখা শেষ": "Checked",
        "বাতিল": "Cancelled",

        // medical-centers.html & hospital-beds.html (Hospital Beds)
        "লাইভ হাসপাতাল বেড স্ট্যাটাস — LifeLine": "Live Hospital Bed Status — LifeLine",
        "হাসপাতাল বেড স্ট্যাটাস — LifeLine": "Hospital Bed Status — LifeLine",
        "বাংলাদেশের হাসপাতালগুলোতে ICU ও ইমার্জেন্সি বেডের বর্তমান তথ্য।": "Real-time ICU & Emergency Bed statistics in Bangladeshi hospitals.",
        "হাসপাতাল বা অবস্থান খুঁজুন...": "Search hospital or location...",
        "সব হাসপাতাল": "All Hospitals",
        "যেকোনো বেড খালি": "Any Bed Available",
        "সীমিত বেড": "Limited Beds Available",
        "বেড খালি নেই": "No Beds Available",
        "বেড পাওয়া যাবে": "Beds Available",
        "🏥 ICU বেড": "🏥 ICU Beds",
        "🚨 ইমার্জেন্সি বেড": "🚨 Emergency Beds",
        "🛏️ সাধারণ বেড": "🛏️ General Beds",
        "মোট ICU": "Total ICU",
        "খালি ICU": "Available ICU",
        "মোট ইমার্জেন্সি": "Total Emergency",
        "খালি ইমার্জেন্সি": "Available Emergency",
        "মোট সাধারণ": "Total General",
        "খালি সাধারণ": "Available General",
        "যোগাযোগ নম্বর": "Contact Number",
        "লাইভ আপডেট": "Live Update",
        "হাসপাতাল authority এখনো বেড তথ্য আপডেট করেনি।": "The hospital administration has not updated bed status yet.",
        "হাসপাতাল কর্তৃপক্ষ এখনো বেড তথ্য আপডেট করেনি।": "The hospital administration has not updated bed status yet.",
        "তথ্য প্রতিটি হাসপাতাল সরাসরি আপডেট করে। সর্বশেষ আপডেটের সময় কার্ডে দেখা যাচ্ছে।": "Stats are updated directly by each hospital. Last updated time is shown on the card.",
        "মার্কারে ক্লিক করলে বিস্তারিত দেখবেন": "Click map marker to view hospital details.",
        "হাসপাতালের অবস্থান ম্যাপ": "Hospital Location Map",
        "কোনো হাসপাতাল পাওয়া যায়নি।": "No hospitals found.",
        "হাসপাতালের তালিকা": "Hospital List",

        // donor-dashboard.html (Donor Dashboard)
        "🩸 রক্তের রিকোয়েস্ট সমূহ": "🩸 Blood Requests Queue",
        "মোট": "Total",
        "গ্রহণ": "Accepted",
        "বাতিল": "Cancelled",
        "আপনার বর্তমান স্ট্যাটাস": "Your Status",
        "রক্ত দিতে প্রস্তুত থাকলে": "If you are ready to donate blood, keep your status as",
        "🟢 Available": "🟢 Available",
        "রাখুন।": "",
        "স্ট্যাটাস বেছে নিন": "Select Status",
        "🟢 Available — রক্ত দিতে প্রস্তুত": "🟢 Available — Ready to Donate",
        "🔴 Busy — এখন ব্যস্ত আছেন": "🔴 Busy — Currently Unavailable",
        "স্ট্যাটাস আপডেট করুন": "Update Status",
        "ডোনার প্রোফাইল": "Donor Profile",
        "প্রোফাইল ও লোকেশন আপডেট": "Update Profile & Location",
        "ফোন নম্বর": "Phone Number",
        "ছাত্র / চাকরি...": "Student / Job / Business...",
        "ম্যাপ থেকে লোকেশন দিন": "Set Location from Map",
        "🔍 জায়গা খুঁজুন...": "🔍 Search location...",
        "আমার অবস্থান": "My Location",
        "ম্যাপ থেকে লোকেশন সিলেক্ট করুন।": "Select location from map.",
        "আপডেট সেভ করুন": "Save Profile Updates",
        "🔒 পাসওয়ার্ড পরিবর্তন করুন (Security Settings)": "🔒 Change Password (Security Settings)",
        "বর্তমান পাসওয়ার্ড": "Current Password",
        "বর্তমান পাসওয়ার্ড দিন": "Enter Current Password",
        "নতুন পাসওয়ার্ড": "New Password",
        "কমপক্ষে ৬ অক্ষর": "Min 6 characters",
        "নিশ্চিত করুন": "Confirm Password",
        "পাসওয়ার্ড পুনরায় দিন": "Re-type Password",
        "পাসওয়ার্ড পরিবর্তন করুন": "Change Password",
        "নতুন পাসওয়ার্ড মিলছে না": "New passwords do not match",
        "পরিবর্তন হচ্ছে...": "Changing...",
        "সার্ভার এরর": "Server Error",

        // doctor-dashboard.html (Doctor Dashboard)
        "LifeLine - Doctor Dashboard": "LifeLine - Doctor Dashboard",
        "অ্যাপয়েন্টমেন্টস": "Appointments",
        "লাইভ ট্র্যাকিং": "Live Tracking",
        "চেম্বার ম্যানেজমেন্ট": "Chamber Management",
        "শিডিউল পরিবর্তন": "Change Schedule",
        "ছুটি / অফ-ডে": "Leave / Off-Day",
        "তারিখ অনুযায়ী ক্যাপাসিটি": "Date Capacity Overrides",
        "তারিখ অনুযায়ী ক্যাপাসিটি": "Date Capacity Overrides",
        "প্রোফাইল আপডেট": "Update Profile",
        "আপনার সিরিয়াল ও রোগীদের কিউ (Queue)": "Your Patient Serials & Queue",
        "অপেক্ষমান রোগী": "Waiting Patients",
        "দেখা শেষ": "Checked Patients",
        "বাতিল সিরিয়াল": "Cancelled Serials",
        "মোট রোগী (আজ)": "Total Patients (Today)",
        "তারিখ নির্বাচন করুন": "Select Date",
        "সব দেখুন": "Show All",
        "অপেক্ষমান রোগী (Waiting List)": "Waiting Patients (Waiting List)",
        "দেখা শেষ (Checked Patients)": "Checked Patients (Completed)",
        "বাতিলকৃত সিরিয়াল (Cancelled list)": "Cancelled Serials (Cancelled)",
        "তারিখ ও সময়": "Date & Time",
        "সিরিয়াল": "Serial",
        "রোগীর নাম": "Patient Name",
        "বয়স/লিঙ্গ": "Age / Gender",
        "সমস্যা": "Illness Details",
        "পেমেন্ট": "Payment",
        "অ্যাকশন": "Actions",
        "কোনো অপেক্ষমান রোগী নেই।": "No waiting patients.",
        "কোনো রোগী দেখা শেষ হয়নি।": "No patients checked yet.",
        "কোনো বাতিলকৃত অ্যাপয়েন্টমেন্ট নেই।": "No cancelled appointments.",
        "লাইভ সিরিয়াল ট্র্যাকিং": "Live Serial Tracking",
        "চেম্বার নির্বাচন করুন": "Select Chamber",
        "আপনার চেম্বারসমূহ": "Your Chambers",
        "নতুন চেম্বার": "New Chamber",
        "চেম্বার/ক্লিনিকের নাম *": "Chamber/Clinic Name *",
        "ঠিকানা *": "Address *",
        "বয়ার দিনসমূহ (উদাঃ শনি, সোম, বুধ) *": "Visiting Days (e.g., Sat, Mon, Wed) *",
        "বসার দিনসমূহ (উদাঃ শনি, সোম, বুধ) *": "Visiting Days (e.g., Sat, Mon, Wed) *",
        "শুরুর সময় *": "Start Time *",
        "শুরুর সময় *": "Start Time *",
        " শেষের সময় *": "End Time *",
        " শেষের সময় *": "End Time *",
        "প্রতি রোগীর জন্য সময় (মিনিট)": "Duration per Patient (mins)",
        "প্রতি রোগীর জন্য সময় (মিনিট)": "Duration per Patient (mins)",
        "যেমন: 15": "e.g. 15",
        "যেমন: 30": "e.g. 30",
        "সর্বোচ্চ ক্যাপাসিটি (প্রতিদিন)": "Max Capacity (Daily Limit)",
        "চেম্বার যোগ করুন": "Add Chamber",
        "ছুটি / অফ-ডে ম্যানেজমেন্ট": "Leave & Off-day Management",
        "ছুটির তারিখ নির্বাচন করুন *": "Select Leave Date *",
        "কারণ (ঐচ্ছিক)": "Reason (Optional)",
        "ছুটি যোগ করুন": "Apply for Leave",
        "আগামী ছুটির দিনসমূহ": "Upcoming Off-days",
        "তারিখ": "Date",
        "কারণ": "Reason",
        "কোনো রেকর্ড নেই।": "No records found.",
        "কোনো রেকর্ড নেই": "No records found.",
        "তারিখ অনুযায়ী ক্যাপাসিটি সেট করুন": "Set Specific Date Capacity Limit",
        "তারিখ অনুযায়ী ক্যাপাসিটি সেট করুন": "Set Specific Date Capacity Limit",
        "চেম্বার নির্বাচন করুন *": "Select Chamber *",
        "তারিখ নির্বাচন করুন *": "Select Date *",
        "এই দিনের সর্বোচ্চ ক্যাপাসিটি *": "Max Patient Limit for this Date *",
        "উদাঃ 20": "e.g. 20",
        "Available (বुकিং চলবে)": "Available (Keep Booking Open)",
        "Available (বুকিং চলবে)": "Available (Keep Booking Open)",
        "Full (আজ আর বুকিং নেওয়া হবে না)": "Full (Stop Bookings for Today)",
        "Full (আজ আর বুকিং নেওয়া হবে না)": "Full (Stop Bookings for Today)",
        "সেভ করুন": "Save Changes",
        "সেট করা স্পেশাল ক্যাপাসিটিসমূহ": "Custom Capacity Adjustments",
        "ক্যাপাসিটি": "Capacity",
        "স্ট্যাটাস": "Status",
        "চেম্বার শিডিউল পরিবর্তন করুন": "Modify Chamber Working Schedule",
        "বসার দিনসমূহ নির্বাচন করুন *": "Select Visiting Days *",
        "শনি (Sat)": "Saturday (Sat)",
        "রবি (Sun)": "Sunday (Sun)",
        "সোম (Mon)": "Monday (Mon)",
        "মঙ্গল (Tue)": "Tuesday (Tue)",
        "বুধ (Wed)": "Wednesday (Wed)",
        "বৃহস্পতি (Thu)": "Thursday (Thu)",
        "শুক্র (Fri)": "Friday (Fri)",
        "শিডিউল আপডেট করুন": "Update Working Schedule",
        "প্রোফাইল ও নিরাপত্তা সেটিংস": "Profile & Security Settings",
        "যোগাযোগের তথ্য ও ভিজিট ফি": "Contact Details & Visit Fees",
        "যোগাযোগের নাম্বার": "Contact Phone Number",
        "ভিজিট ফি (৳)": "Consultation Fee (৳)",
        "যেসব রোগের চিকিৎসা দেন (কমা দিয়ে লিখুন)": "Diseases Treated (separated by commas)",
        "যেমন: হৃদরোগ, উচ্চ রক্তচাপ, ডায়াবেটিস": "e.g. Heart disease, hypertension, diabetes",
        "প্রোফাইল আপডেট করুন": "Save Profile",
        "অ্যাকাউন্ট পাসওয়ার্ড পরিবর্তন": "Change Portal Password",
        "বর্তমান পাসওয়ার্ড দিন": "Enter Current Password",
        "নতুন পাসওয়ার্ড / (কমপক্ষে ৬ অক্ষর)": "New Password (Min 6 Characters)",
        "নতুন পাসওয়ার্ড": "New Password",
        "নতুন পাসওয়ার্ড নিশ্চিত করুন": "Confirm New Password",
        "পাসওয়ার্ড পরিবর্তন করুন": "Update Password",
        "মুছুন": "Delete",
        "বছর": "Yrs",
        "প্রেসক্রিপশন": "Prescription",
        "টেস্ট রেফারাল": "Test Referral",

        // hospital-dashboard.html (Hospital Dashboard)
        "হাসপাতাল ড্যাশবোর্ড - LifeLine": "Hospital Dashboard - LifeLine",
        "বেড তথ্য আপডেট": "Update Bed Statistics",
        "লাইভ বেড ভিউ (পাবলিক দেখবে)": "Live Bed Status (Public Page)",
        "বেড খালি নেই": "Beds Full",
        "আইসিইউ বেড (ICU Beds)": "ICU Beds (ICU)",
        "ইমার্জেন্সি বেড (Emergency Beds)": "Emergency Beds (Emergency)",
        "সাধারণ বেড (General Beds)": "General Beds (General)",
        "মোট বেড": "Total Beds",
        "ভর্তি রোগী": "Admitted Patients",
        "খালি বেড": "Available Beds",
        "আপডেট সেভ করুন": "Save Bed Updates",
        "ডাক্তার ম্যানেজমেন্ট": "Manage Doctors",
        "নতুন ডাক্তার যোগ করুন": "Add New Doctor",
        "ডাক্তারের নাম *": "Doctor's Name *",
        "যোগাযোগ নম্বর": "Contact Phone",
        "বিশেষজ্ঞতা *": "Medical Specialty *",
        "পদবি": "Designation",
        "যেমন: অ্যাসিস্ট্যান্ট প্রফেসর": "e.g. Assistant Professor",
        "ভিজিট ফি (৳) *": "Consultation Fee (৳) *",
        "যেমন: 800": "e.g. 800",
        "বসার দিনসমূহ *": "Visiting Days *",
        "যেমন: শনি, সোম, বুধ": "e.g. Sat, Mon, Wed",
        "রোগী দেখার সময় *": "Consulting Hours *",
        "যেমন: বিকাল ৪টা - রাত ৮টা": "e.g. 4:00 PM - 8:00 PM",
        "রোগী দেখার ক্যাপাসিটি *": "Patient Capacity *",
        "যেমন: 30": "e.g. 30",
        "ডাক্তার যোগ করুন": "Register Doctor",
        "নিবন্ধিত বিশেষজ্ঞ ডাক্তার": "Registered Specialists",
        "কোনো ডাক্তার যোগ করা হয়নি": "No doctors registered yet.",
        "হাসপাতাল প্রোফাইল": "Hospital Profile",
        "দায়িত্বপ্রাপ্ত কর্মকর্তা": "Authorized Officer",
        "লাইসেন্স": "License/Registration Code",
        "ম্যাপ থেকে লোকেশন সেট করুন": "Pin Location on Map",
        "💾 পরিবর্তন সেভ করুন": "💾 Save Profile Changes",

        // prescription.html
        "প্রেসক্রিপশন তৈরি": "Prescription Generator",
        "রোগী:": "Patient:",
        "বয়স:": "Age:",
        "লিঙ্গ:": "Gender:",
        "রোগ নির্ণয় (Diagnosis)": "Diagnosis / Illness",
        "ঔষধ (Medications)": "Medications / Rx",
        "ঔষধের নাম": "Medicine Name",
        "যেমন: Napa Extend": "e.g. Napa Extend",
        "মাত্রা (Dosage)": "Dosage Pattern",
        "খাওয়ার সময়": "Timing",
        "খাবারের আগে": "Before Meal",
        "খাবারের পর": "After Meal",
        "কতদিন (Duration)": "Duration",
        "যেমন: ৫ দিন": "e.g. 5 Days",
        "নির্দেশনা (ঐচ্ছিক)": "Instruction (Optional)",
        "যেমন: ব্যথা বেশি হলে খাবেন": "e.g. Take only if pain persists",
        "ঔষধ যোগ করুন": "+ Add Medicine",
        "পরীক্ষা (Investigations)": "Investigations (Tests)",
        "যেমন: CBC, Chest X-Ray": "e.g. CBC, Chest X-Ray",
        "পরীক্ষা যোগ করুন": "+ Add Medical Test",
        "উপদেশ (Advices)": "Doctor Advice",
        "যেমন: পর্যাপ্ত বিশ্রাম নিন": "e.g. Get plenty of rest",
        "উপদেশ যোগ করুন": "+ Add Advice",
        "পরবর্তী সাক্ষাৎ": "Follow-up / Next Visit",
        "যেমন: ৭ দিন পর": "e.g. After 7 Days",
        "প্রেসক্রিপশন তৈরি করুন": "Generate Prescription",

        // Additional system alerts & confirmations & toast messages
        "নতুন পাসওয়ার্ড মিলছে না": "New passwords do not match",
        "পরিবর্তন হচ্ছে...": "Saving changes...",
        "সার্ভার এরর": "Server error. Please try again.",
        "সফলভাবে সেট করা হয়েছে!": "Successfully updated!",
        "আপডেট ব্যর্থ হয়েছে!": "Update failed!",
        "চেম্বার সফলভাবে মুছে ফেলা হয়েছে!": "Chamber successfully deleted!",
        "শিডিউল আপডেট হয়েছে!": "Schedule successfully updated!",
        "চেম্বার যুক্ত হয়েছে!": "Chamber successfully added!",
        "আপনি কি এই রেকর্ডটি মুছে ফেলতে চান?": "Are you sure you want to delete this record?",
        "আপনি কি এই চেম্বারটি মুছে ফেলতে চান? এটি মুছে ফেললে এর সমস্ত অ্যাপয়েন্টমেন্ট ও সেটিংস মুছে যাবে!": "Are you sure you want to delete this chamber? All associated appointments & settings will be deleted!",
        "আপনি কি এই ছুটি মুছে ফেলতে চান?": "Are you sure you want to delete this leave record?",
        "আপনি কি এই অ্যাপয়েন্টমেন্ট মুছে ফেলতে চান?": "Are you sure you want to delete this appointment?",
        "নিশ্চিত করুন": "Are you sure?",
        "ত্রুটি হয়েছে। আবার চেষ্টা করুন।": "Error occurred. Please try again.",
        "লোকেশন পাওয়া যায়নি। অনুগ্রহ করে ম্যাপে ম্যানুয়ালি ক্লিক করুন।": "Location not found. Please select manually on the map.",
        "এই চেম্বারের আজকের সিরিয়াল খালি নেই। অন্য দিনের জন্য চেষ্টা করুন।": "This chamber is fully booked for today. Please try another day.",
        "অনুরোধ সফল হয়েছে": "Request successful",
        "লগইন সফল!": "Login successful!",
        "লগইন ব্যর্থ হয়েছে": "Login failed. Please check credentials.",
        "স্ট্যাটাস আপডেট হয়েছে!": "Status updated successfully!",
        "কমপক্ষে একটি দিন সিলেক্ট করুন।": "Please select at least one day.",
        "অনুগ্রহ করে একটি সঠিক নাম দিন (২-৫০ অক্ষরের মধ্যে, শুধু অক্ষর, ডট বা স্পেস)।": "Please enter a valid name (2-50 characters, letters only).",
        "অনুগ্রহ করে একটি সঠিক বাংলাদেশী মোবাইল নাম্বার দিন (যেমন: 017XXXXXXXX)।": "Please enter a valid Bangladeshi mobile number (e.g. 017XXXXXXXX).",
        "অনুগ্রহ করে একটি সঠিক ইমেইল এড্রেস দিন।": "Please enter a valid email address.",
        "অনুগ্রহ করে একটি সঠিক বয়স দিন (০ থেকে ১২০ এর মধ্যে)।": "Please enter a valid age (between 0 and 120).",
        "অনুগ্রহ করে রোগীর লিঙ্গ নির্বাচন করুন।": "Please select the patient's gender.",
        "অনুগ্রহ করে সমস্যা সংক্ষেপে লিখুন।": "Please describe the problem briefly.",

        // Time Contexts
        "(সকাল)": "(Morning)",
        "(দুপুর)": "(Noon)",
        "(বিকাল)": "(Afternoon)",
        "(সন্ধ্যা)": "(Evening)",
        "(রাত)": "(Night)"
    };

    // State: Check localStorage, default to 'bn'
    let currentLang = localStorage.getItem('preferred_lang') || 'bn';

    // Intercept native Alerts & Confirms to translate them dynamically
    const originalAlert = window.alert;
    window.alert = function(msg) {
        if (!msg) return originalAlert(msg);
        const strMsg = String(msg).trim();
        if (currentLang === 'en' && dictionary[strMsg]) {
            originalAlert(dictionary[strMsg]);
        } else {
            // Substring replacement for dynamic alert strings
            let translated = strMsg;
            for (const key in dictionary) {
                if (translated.includes(key)) {
                    translated = translated.replace(new RegExp(key, 'g'), dictionary[key]);
                }
            }
            originalAlert(translated);
        }
    };

    const originalConfirm = window.confirm;
    window.confirm = function(msg) {
        if (!msg) return originalConfirm(msg);
        const strMsg = String(msg).trim();
        if (currentLang === 'en' && dictionary[strMsg]) {
            return originalConfirm(dictionary[strMsg]);
        } else {
            let translated = strMsg;
            for (const key in dictionary) {
                if (translated.includes(key)) {
                    translated = translated.replace(new RegExp(key, 'g'), dictionary[key]);
                }
            }
            return originalConfirm(translated);
        }
    };

    // Helper to see if a node contains Bengali text
    function hasBengali(text) {
        return /[\u0980-\u09FF]/.test(text);
    }

    // Traverse DOM to translate text content
    function translateDOM(targetNode, lang) {
        if (!targetNode) return;
        
        const walker = document.createTreeWalker(
            targetNode,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while (node = walker.nextNode()) {
            const parent = node.parentNode;
            // Prevent translating text inside scripts, styles, or switcher itself
            if (parent && (
                parent.tagName === 'SCRIPT' || 
                parent.tagName === 'STYLE' || 
                parent.classList.contains('lang-switcher-capsule') ||
                parent.classList.contains('lang-switcher-btn') ||
                parent.classList.contains('nav-lang-switcher') ||
                parent.classList.contains('nav-lang-btn')
            )) {
                continue;
            }

            const rawText = node.nodeValue;
            if (!rawText) continue;
            
            const cleanText = rawText.trim();
            if (!cleanText) continue;

            if (lang === 'en') {
                if (dictionary[cleanText]) {
                    // Store original Bengali text
                    if (!parent.hasAttribute('data-orig-bn')) {
                        parent.setAttribute('data-orig-bn', rawText);
                    }
                    node.nodeValue = rawText.replace(cleanText, dictionary[cleanText]);
                } else {
                    // Try substring match for complex items
                    let matched = false;
                    let tempText = rawText;
                    for (const bnKey in dictionary) {
                        if (cleanText.includes(bnKey)) {
                            matched = true;
                            tempText = tempText.replace(new RegExp(bnKey, 'g'), dictionary[bnKey]);
                        }
                    }
                    if (matched) {
                        if (!parent.hasAttribute('data-orig-bn')) {
                            parent.setAttribute('data-orig-bn', rawText);
                        }
                        node.nodeValue = tempText;
                    }
                }
            } else { // Switch back to Bengali
                if (parent && parent.hasAttribute('data-orig-bn')) {
                    node.nodeValue = parent.getAttribute('data-orig-bn');
                }
            }
        }

        // Translate inputs and placeholder attributes
        const inputs = targetNode.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            const ph = input.getAttribute('placeholder');
            if (ph) {
                const cleanPh = ph.trim();
                if (lang === 'en') {
                    if (dictionary[cleanPh]) {
                        if (!input.hasAttribute('data-orig-ph')) {
                            input.setAttribute('data-orig-ph', ph);
                        }
                        input.setAttribute('placeholder', dictionary[cleanPh]);
                    }
                } else {
                    if (input.hasAttribute('data-orig-ph')) {
                        input.setAttribute('placeholder', input.getAttribute('data-orig-ph'));
                    }
                }
            }

            const val = input.getAttribute('value');
            if (val && hasBengali(val)) {
                const cleanVal = val.trim();
                if (lang === 'en') {
                    if (dictionary[cleanVal]) {
                        if (!input.hasAttribute('data-orig-val')) {
                            input.setAttribute('data-orig-val', val);
                        }
                        input.setAttribute('value', dictionary[cleanVal]);
                    }
                } else {
                    if (input.hasAttribute('data-orig-val')) {
                        input.setAttribute('value', input.getAttribute('data-orig-val'));
                    }
                }
            }
        });

        // Translate select options
        const options = targetNode.querySelectorAll('option');
        options.forEach(opt => {
            const optText = opt.textContent.trim();
            if (lang === 'en') {
                if (dictionary[optText]) {
                    if (!opt.hasAttribute('data-orig-bn')) {
                        opt.setAttribute('data-orig-bn', opt.textContent);
                    }
                    opt.textContent = dictionary[optText];
                }
            } else {
                if (opt.hasAttribute('data-orig-bn')) {
                    opt.textContent = opt.getAttribute('data-orig-bn');
                }
            }
        });
    }

    // Set page language attributes
    function applyLanguage(lang) {
        document.documentElement.setAttribute('lang', lang);
        translateDOM(document.body, lang);
        
        // Update switcher buttons
        const floatingBtns = document.querySelectorAll('.lang-switcher-btn');
        floatingBtns.forEach(btn => {
            if (btn.getAttribute('data-lang') === lang) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const navBtns = document.querySelectorAll('.nav-lang-btn');
        navBtns.forEach(btn => {
            if (btn.getAttribute('data-lang') === lang) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // Toggle language
    function setLanguage(lang) {
        currentLang = lang;
        localStorage.setItem('preferred_lang', lang);
        applyLanguage(lang);
    }

    // Inject Switcher UI into DOM
    function injectSwitcher() {
        // Remove existing switcher if already loaded to avoid duplication
        const existingCapsule = document.querySelector('.lang-switcher-capsule');
        if (existingCapsule) existingCapsule.remove();
        
        // 1. Floating Capsule Switcher
        const floatingCapsule = document.createElement('div');
        floatingCapsule.className = 'lang-switcher-capsule';
        floatingCapsule.innerHTML = `
            <button class="lang-switcher-btn ${currentLang === 'bn' ? 'active' : ''}" data-lang="bn">বাংলা</button>
            <button class="lang-switcher-btn ${currentLang === 'en' ? 'active' : ''}" data-lang="en">EN</button>
        `;
        document.body.appendChild(floatingCapsule);

        // Bind clicks to floating buttons
        floatingCapsule.querySelectorAll('.lang-switcher-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setLanguage(btn.getAttribute('data-lang'));
            });
        });

        // 2. Inline Navbar Integration (Try to insert inside navbar if it exists)
        // const header = document.querySelector('nav .nav-inner, header .header-container, .logo');
        if (header) {
            const navSwitcher = document.createElement('div');
            navSwitcher.className = 'nav-lang-switcher';
            navSwitcher.innerHTML = `
                <button class="nav-lang-btn ${currentLang === 'bn' ? 'active' : ''}" data-lang="bn">বাং</button>
                <button class="nav-lang-btn ${currentLang === 'en' ? 'active' : ''}" data-lang="en">EN</button>
            `;
            // Insert it before the first child or inside the nav links
            const navLinks = header.querySelector('.nav-links, .nav-items');
            if (navLinks) {
                navLinks.insertBefore(navSwitcher, navLinks.firstChild);
            } else {
                header.appendChild(navSwitcher);
            }

            // Bind clicks to navbar buttons
            navSwitcher.querySelectorAll('.nav-lang-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    setLanguage(btn.getAttribute('data-lang'));
                });
            });
        }
    }

    // Initialize switcher on DOM loaded
    function init() {
        injectSwitcher();
        applyLanguage(currentLang);

        // Setup MutationObserver to watch for dynamically loaded text nodes and translate them
        const observer = new MutationObserver((mutations) => {
            if (currentLang === 'en') {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            translateDOM(node, 'en');
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            // If direct text node added, translate its parent
                            if (node.parentNode) {
                                translateDOM(node.parentNode, 'en');
                            }
                        }
                    });
                });
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
