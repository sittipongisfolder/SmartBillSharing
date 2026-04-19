# SmartBill - Test Execution Guide 🚀

## ก่อนทำ Presentation (Day-1)

### 1️⃣ Setup Test Environment
```bash
# ใน Terminal ทำครั้งเดียว
npm install
npm run build
npm run dev

# ตรวจสอบว่า localhost:3000 ทำงาน
```

### 2️⃣ Prepare Test Data (สร้าง test accounts)
```
Account A (Admin/Owner):
- Email: owner@test.com
- Password: Test1234!
- Bank: KBank, Account: 123456789
- PromptPay: 0812345678

Account B (Friend):
- Email: friend@test.com
- Password: Test1234!
- Bank: BBL, Account: 987654321

Account C (Guest):
- Email: guest@test.com (สำหรับ guest access flow)
```

### 3️⃣ Create Demo Bills Before Presentation
**Bill 1 - Equal Split (ตัวอย่างสำหรับสดวกการดู)**
- Name: "Dinner at Issaya Siamese"
- Items: Pad Thai (300 บาท), Larb (250 บาท)
- Total: 550 บาท
- Participants: Account A, B + 1 guest
- Status: Published (มี invite link)
- State: Some paid, some pending

**Bill 2 - Percentage Split**
- Name: "Road Trip Gas & Tolls"
- Items: Gas (600 บาท), Tolls (200 บาท)
- Total: 800 บาท
- Participants: A (50%), B (30%), C (20%)
- Status: Draft (ยังไม่ publish)

**Bill 3 - Item Assignment**
- Name: "Birthday Party Celebration"
- Items: Cake (400), Drinks (300), Snacks (200)
- Participants: A, B, 2 guests
- Status: Published with some payments

### 4️⃣ Day-Before Checklist

#### Environment Check
- [ ] Browser console clean (no errors)
- [ ] Database connected (MongoDB)
- [ ] Email sending works (SMTP configured or dev logs)
- [ ] Cloudinary connection OK (for image upload)
- [ ] NextAuth session working

#### Quick Smoke Tests
```
TEST-QUICK-001: Login Flow
- [ ] A ล็อกอินได้
- [ ] Dashboard load
- [ ] Logout ทำงาน

TEST-QUICK-002: View Bills
- [ ] Bills list แสดง
- [ ] Click to view detail ทำงาน
- [ ] Numbers ถูกต้อง

TEST-QUICK-003: Notifications
- [ ] Bell icon ปรากฏ
- [ ] Click ได้

TEST-QUICK-004: Settings
- [ ] Profile ดูได้
- [ ] Edit bank info ได้
```

---

## 🎯 During Presentation (Test Sequence)

### Phase 1: Auth Demo (3-4 min)
**Live Demo:** ล็อกเข้า Account A
```
1. Open localhost:3000
2. Already logged in? Clear cookies & logout first
3. ไปที่ /login
4. Input: owner@test.com / Test1234!
5. Click Login
✅ Dashboard ปรากฏ
```

### Phase 2: Bill Creation (5-7 min)
**Live Demo:** สร้าง Equal Split Bill

```
1. Click "Create Bill" / "Open Bills"
2. Select "Equal Split" (/open-bill/create-equal)
3. Fill:
   - Bill Name: "Team Lunch"
   - Items:
     * Pad Thai - 300 บาท
     * Som Tam - 250 บาท
     * Rice - 50 บาท
   - Total: 600 บาท
4. Add Participants:
   - Your Name (auto)
   - Friend Name
   - Guest Name
5. Verify split: 600 ÷ 3 = 200 each
6. Click "Create Bill"
✅ Bill สร้างสำเร็จ (status: draft)
```

### Phase 3: Invite & Payment (5-7 min)
**Live Demo:** Publish bill & payment flow

```
1. Click "Publish Bill"
✅ Generate invite link (/i/<token>)
2. Share link to guest (แค่บอก URL)
3. Open new browser tab / private window
4. Paste invite link
✅ Guest page ปรากฏ
5. Guest select ชื่อตัวเอง
6. Enter email & click "Join"
✅ Guest session created
7. Guest view bill detail + amount ต้องจ่าย
8. Click "Pay with PromptPay"
✅ QR code สร้าง (show on screen)
9. Back to owner account
10. Refresh bill detail
✅ Payment status updated (if already marked paid)
```

### Phase 4: Friends System (3-4 min)
**Live Demo:** Add friend

```
1. Click "Friends" menu
2. Click "Add Friend"
3. Search: friend@test.com
4. Click "Add"
✅ Status: "Pending"
5. Switch to Account B (another browser)
6. View notifications
✅ Friend request ปรากฏ
7. Click "Accept"
✅ Status: "Friends"
```

### Phase 5: Admin Features (2-3 min)
**Live Demo:** Admin can verify payments

```
1. Switch to admin account / Account A (if admin)
2. Go to /admin
✅ Dashboard stats ปรากฏ
3. Click "Bills"
✅ List all bills
4. Click 1 bill
✅ See participants + payment status
5. View receipts (if uploaded)
6. Click "Verify" / "Approve"
✅ Payment marked verified
```

### Phase 6: Notifications & Settings (2-3 min)
**Live Demo:** Notification system

```
1. Click notification bell (top right)
✅ List ปรากฏ
2. Recent notifications:
   - Bill invitation
   - Payment received
   - Friend accepted
3. Click "Mark as Read"
✅ Visual indicator changes
4. Go to Settings
5. Toggle notification types (enable/disable)
✅ Settings saved
```

---

## ⚡ Quick Fix Guide (If Something Breaks)

### Page won't load
```bash
# Clear cache
Ctrl+Shift+R  # Force refresh
# Or
npm run dev   # Restart server
```

### Auth session lost
```
Clear cookies:
1. DevTools → Application
2. Cookies → localhost
3. Delete all
4. Refresh & login again
```

### Database error
```
Check MongoDB:
1. Is Mongoose connected?
2. Check .env MONGODB_URI
3. Check Network tab for API errors
```

### Image upload fails
```
Check Cloudinary:
1. Verify .env NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
2. Check Network tab → upload-receipt API
```

### EMAIL not sending (dev mode)
```
Check server logs:
1. Open terminal where npm run dev runs
2. Look for reset link in console
3. Copy & use link directly
```

---

## 📊 Key Metrics to Mention

### Performance
- **Dashboard Load:** < 1 sec
- **Bill Creation:** < 2 sec
- **Payment Processing:** Real-time
- **API Response:** < 500ms

### Features Count
- **3 Bill Split Types** (equal, percent, separate)
- **50+ Test Cases** (auth, bills, friends, payments, etc.)
- **Multiple Notification Channels** (UI, Email, LINE)
- **PromptPay QR Integration**
- **OCR Receipt Scanning** (with admin verification)
- **Admin Dashboard** (users, bills, activity logs)
- **Role-based Access** (user vs admin vs guest)

### Security Features
- ✅ Password hashing (bcryptjs)
- ✅ Session management (NextAuth)
- ✅ CSRF protection
- ✅ Authorization checks
- ✅ Rate limiting (optional)
- ✅ Input sanitization

---

## 🎤 Presentation Talking Points

**Opening (1 min):**
"SmartBill is a bill-splitting app that makes it easy for groups to share expenses. 
Today I'll show you 3 main features: creating bills, tracking payments, and managing friends."

**Feature Demo (7 min):**
1. **Bill Creation:** Multiple split methods (equal, percentage, item-based)
2. **Payment Tracking:** PromptPay QR + manual verification with OCR
3. **Friend System:** Social features for recurring groups
4. **Admin Dashboard:** Centralized payment verification
5. **Notifications:** Real-time updates via UI, email, LINE

**Closing (1 min):**
"The system is secure, responsive, and scales to handle multiple concurrent users. 
It's production-ready for a small-to-medium group expense tracking tool."

---

## 🚨 Critical Test Points (MUST VERIFY)

### Before Starting Demo
- [ ] **Server Running:** Terminal shows "✓ Ready in Xms"
- [ ] **Database Connected:** No MongoDB errors in console
- [ ] **Env Loaded:** Check that all variables loaded (especially for Cloudinary, SMTP)
- [ ] **Test Data Ready:** 
  - [ ] Account A logged in & have published bills
  - [ ] Account B exists (for friend demo)
  - [ ] Test bill ready to demo

### During Demo
- [ ] **No Console Errors:** Open DevTools (F12) → Console should be clean
- [ ] **All Buttons Responsive:** Click things to verify they work
- [ ] **Data Accuracy:** Numbers add up correctly in bills
- [ ] **Network Calls:** Check Network tab to ensure API calls succeed

### After Demo
- [ ] **Database Consistent:** All data changes persisted
- [ ] **No Broken Links:** All pages accessible
- [ ] **Graceful Errors:** If something fails, show error message (don't crash)

---

## 🎥 Optional: Record Demo First

Before live presentation, consider:
1. **Record a demo video** (with OBS or similar)
2. **Use it as backup** if live demo fails
3. **Show specific paths:** 
   - Bill creation flow
   - Payment with QR code
   - Friend request acceptance
4. **Total video:** ~5-10 minutes

---

## 📱 Mobile Demo (Optional)

If presenter asks "Does it work on mobile?"
```
1. Open DevTools → Toggle device toolbar (Ctrl+Shift+M)
2. Select iPhone 14 Pro
3. Demo same flows
✅ Responsive design works
```

---

## 🔄 After Presentation

### Collect Feedback
- [ ] Ask: "Are the bill split methods clear?"
- [ ] Ask: "Is payment flow intuitive?"
- [ ] Ask: "Any missing features?"

### Record Issues
- [ ] If bug found, ask "Can you repeat that?"
- [ ] Take screenshot
- [ ] Add to GitHub issues

### Next Steps
- [ ] Deploy to production (if approved)
- [ ] Setup CI/CD
- [ ] Monitor error logs
- [ ] Gather user feedback

---

## 🆘 Emergency Backup Plan

If live demo fails completely:

**Plan B - Recorded Demo:**
```
Pre-recorded video showing:
1. 30 sec: Account creation
2. 1 min: Bill creation (equal split)
3. 1 min: Invite & guest payment
4. 30 sec: Payment verification
5. 30 sec: Notifications
Total: ~4 minutes
```

**Plan C - Screenshots + Walkthrough:**
```
Show screenshots with narration:
- Bill list dashboard
- Bill detail with participants
- PromptPay QR code
- Payment history
- Admin dashboard
```

---

## ✅ Final Checklist (1 hour before presentation)

```
ENVIRONMENT
- [ ] npm run dev ทำงาน (port 3000)
- [ ] No red errors in console
- [ ] Browser cache clear
- [ ] .env file configured

TEST DATA
- [ ] Account A ready (owner role)
- [ ] Account B ready (friend)
- [ ] 1-2 published bills ready
- [ ] Payment history visible

BROWSER SETUP
- [ ] Chrome/Firefox open
- [ ] DevTools close (F12 to toggle if needed)
- [ ] Zoom at 100% (Ctrl+0)
- [ ] Full screen ready

NETWORK
- [ ] Internet connected
- [ ] APIs responding
- [ ] No CORS errors

PRESENTATION MATERIALS
- [ ] Slides ready (if any)
- [ ] Demo script printed/ready
- [ ] Backup video accessible
- [ ] Screenshots ready

PERSONAL
- [ ] Confident with flows
- [ ] Know keyboard shortcuts
- [ ] Have water nearby 💧
```

---

**Good luck! You got this! 🎉**

*If you need to demo specific edge cases, refer back to TEST_CASES.md*
