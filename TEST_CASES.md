# SmartBill Test Cases - ผมทดสอบแบบนี้

## 📋 สารบัญ
1. [Authentication](#-authentication)
2. [Bill Management](#-bill-management)
3. [Friend System](#-friend-system)
4. [Guest Access](#-guest-access)
5. [Payment System](#-payment-system)
6. [Notifications](#-notifications)
7. [LINE Integration](#-line-integration)
8. [OCR Receipt Scanning](#-ocr-receipt-scanning)
9. [Admin Features](#-admin-features)
10. [Edge Cases & Security](#-edge-cases--security)

---

## 🔐 Authentication

### TC-AUTH-001: User Registration
**Prerequisite:** ไม่มี account อยู่
**Steps:**
1. ไปที่ `/register`
2. กรอก name, email, password, password confirm
3. กรอก bank ชื่อธนาคาร และ account number
4. คลิก Register

**Expected Result:**
- ✅ Account สร้างสำเร็จ
- ✅ ถูกเปลี่ยนไปหน้า login
- ✅ Email unique validation ทำงาน (ไม่สามารถสร้าง account ซ้ำได้)
- ✅ Password validation ทำงาน (ต้องตรงกัน)
- ✅ Bank info บันทึกถูกต้อง

### TC-AUTH-002: User Login
**Prerequisite:** มี account อยู่แล้ว
**Steps:**
1. ไปที่ `/login`
2. กรอก email และ password
3. คลิก Login

**Expected Result:**
- ✅ ล็อกอินสำเร็จ
- ✅ เปลี่ยนไปหน้า dashboard
- ✅ Session บันทึกใน cookie ถูกต้อง

### TC-AUTH-003: Login with Wrong Credentials
**Steps:**
1. ไปที่ `/login`
2. กรอก email ถูกแต่ password ผิด
3. คลิก Login

**Expected Result:**
- ✅ แสดง error message
- ✅ ไม่ได้ล็อกอิน
- ✅ ยังอยู่ที่หน้า login

### TC-AUTH-004: Forgot Password Flow
**Steps:**
1. ไปที่ `/forgot-password`
2. กรอก email ที่ลงทะเบียน
3. คลิก Submit
4. ตรวจสอบ email (หรือ server logs)
5. คลิก reset link
6. กรอก password ใหม่
7. คลิก Reset Password

**Expected Result:**
- ✅ Reset link ส่งถูกต้อง
- ✅ Link ใช้ได้เพียงครั้งเดียว
- ✅ Password เปลี่ยนสำเร็จ
- ✅ ล็อกอินด้วย password ใหม่ได้

### TC-AUTH-005: Password Expiry & Invalid Token
**Steps:**
1. ทำ TC-AUTH-004 แต่รอให้ reset token หมดอายุ
2. พยายามใช้ reset link ที่หมดอายุ

**Expected Result:**
- ✅ แสดง error "Token expired"
- ✅ ต้องทำ forgot password ใหม่

### TC-AUTH-006: Logout
**Prerequisite:** ล็อกอินแล้ว
**Steps:**
1. ไปที่ navbar
2. คลิก Logout

**Expected Result:**
- ✅ Session ถูก clear
- ✅ เปลี่ยนไปหน้า login
- ✅ ไม่สามารถเข้า protected routes ได้

---

## 💰 Bill Management

### TC-BILL-001: Create Equal Split Bill
**Prerequisite:** ล็อกอินแล้ว
**Steps:**
1. ไปที่ `/open-bill/create-equal`
2. กรอก bill name "Dinner with friends"
3. กรอก items: Pad Thai 300 บาท (qty 1), Larb 250 บาท (qty 1)
4. รวม 550 บาท
5. เพิ่ม participants (ตัวเอง + 2 คน)
6. กรอก participant names
7. กลับไปเลือก split mode "Equal"
8. คลิก Create Bill

**Expected Result:**
- ✅ Bill สร้างสำเร็จในสถานะ "draft"
- ✅ แต่ละคนควร 550 ÷ 3 = 183.33 บาท
- ✅ Total ถูกต้อง 550 บาท
- ✅ Participants บันทึกถูกต้อง
- ✅ สามารถดู bill ได้

### TC-BILL-002: Create Percentage Split Bill
**Steps:**
1. ไปที่ `/open-bill/create-percent`
2. กรอก items: Steak 1000 บาท
3. เพิ่ม 3 participants
4. ตั้ง percentage: คน1 = 50%, คน2 = 30%, คน3 = 20%
5. คลิก Create Bill

**Expected Result:**
- ✅ Bill สร้างสำเร็จ
- ✅ คน1 = 500 บาท
- ✅ คน2 = 300 บาท
- ✅ คน3 = 200 บาท
- ✅ Percentage validation (ต้องรวม 100%)

### TC-BILL-003: Create Separate Bill (Item Assignment)
**Steps:**
1. ไปที่ `/open-bill/create-separated`
2. สร้าง 2 items: Item A (500 บาท), Item B (300 บาท)
3. Item A กำหนดให้คน1 + คน2
4. Item B กำหนดให้คน2 + คน3
5. คลิก Create Bill

**Expected Result:**
- ✅ Bill สร้างสำเร็จ
- ✅ คน1: 250 บาท (Item A ÷ 2)
- ✅ คน2: 400 บาท (Item A ÷ 2 + Item B ÷ 2)
- ✅ คน3: 150 บาท (Item B ÷ 2)
- ✅ Items ถูกเชื่อมกับ participants

### TC-BILL-004: Edit Draft Bill
**Prerequisite:** สร้าง draft bill แล้ว
**Steps:**
1. เข้าดู draft bill
2. เพิ่ม item ใหม่
3. เปลี่ยนชื่อ participant
4. ลบ participant ที่ไม่จำเป็น
5. คลิก Save

**Expected Result:**
- ✅ Bill อัพเดทสำเร็จ
- ✅ ตัวเลขปรับปรุงใหม่ถูกต้อง
- ✅ Draft status ยังคงอยู่

### TC-BILL-005: Publish Bill & Invite Friends
**Prerequisite:** มี draft bill พร้อม
**Steps:**
1. เข้า draft bill
2. ตรวจสอบข้อมูล
3. คลิก "Publish Bill"
4. โปรแกรมสร้าง invite link
5. ส่ง link ไปยัง participants

**Expected Result:**
- ✅ Bill เปลี่ยนสถานะเป็น "published"
- ✅ Invite link สร้างสำเร็จ `/i/<token>`
- ✅ แต่ละ participant ได้ unique link
- ✅ ส่งผ่าน email/LINE ได้

### TC-BILL-006: View Bill Details
**Prerequisite:** มี bill อยู่
**Steps:**
1. ไปที่ bills list
2. คลิกบิล
3. ดูรายละเอียด items, participants, total

**Expected Result:**
- ✅ ข้อมูลทั้งหมดแสดงถูกต้อง
- ✅ Participants list ครบ
- ✅ Payment status สำหรับแต่ละคน
- ✅ สามารถจ่ายเงินได้

### TC-BILL-007: Delete Bill
**Prerequisite:** มี draft bill
**Steps:**
1. เข้า draft bill
2. คลิก Delete
3. ยืนยันการลบ

**Expected Result:**
- ✅ Bill ถูกลบ
- ✅ ไม่สามารถเข้าเบิลได้อีก
- ✅ ลบเฉพาะ draft bill (published bill ต้องมี rules)

---

## 👥 Friend System

### TC-FRIEND-001: Send Friend Request
**Prerequisite:** ล็อกอินด้วย account A
**Steps:**
1. ไปที่ `/friends`
2. คลิก "Add Friend"
3. ค้นหา email ของ account B
4. คลิก "Add"

**Expected Result:**
- ✅ Friend request ส่งสำเร็จ
- ✅ ปุ่มเปลี่ยนเป็น "Pending"
- ✅ Account B ได้รับ notification

### TC-FRIEND-002: Accept Friend Request
**Prerequisite:** Account B ได้รับ request จาก A
**Steps:**
1. ล็อกอินด้วย account B
2. ไปที่ notifications หรือ friends page
3. คลิก "Accept"

**Expected Result:**
- ✅ Friend request accepted
- ✅ A และ B กลายเป็น friends
- ✅ ตัวเลขใน friends list เพิ่มขึ้น 1
- ✅ A ได้รับ notification "B accepted your request"

### TC-FRIEND-003: Reject Friend Request
**Prerequisite:** Account C ได้รับ request จาก A
**Steps:**
1. ล็อกอินด้วย account C
2. ไปที่ notifications
3. คลิก "Reject"

**Expected Result:**
- ✅ Friend request ถูก reject
- ✅ A และ C ไม่ได้เป็น friends
- ✅ A ได้รับ notification "C declined your request"

### TC-FRIEND-004: Remove Friend
**Prerequisite:** A และ B เป็น friends
**Steps:**
1. ล็อกอินด้วย account A
2. ไปที่ `/friends`
3. ค้นหา B
4. คลิก "Remove"

**Expected Result:**
- ✅ Friend relationship ลบสำเร็จ
- ✅ B ได้รับ notification
- ✅ Friends list update ทั้งสองฝ่าย

### TC-FRIEND-005: List Friends
**Prerequisite:** มี friends หลายคน
**Steps:**
1. ไปที่ `/friends`
2. ดูรายชื่อ friends

**Expected Result:**
- ✅ แสดง friends ทั้งหมด
- ✅ แสดง friend requests pending
- ✅ Pagination ทำงานถูก (ถ้ามี)

### TC-FRIEND-006: Cancel Friend Request
**Prerequisite:** ส่ง request แต่ยังไม่ accept
**Steps:**
1. ไปที่ `/friends`
2. หา request ที่เป็น "Pending"
3. คลิก "Cancel"

**Expected Result:**
- ✅ Request ลบสำเร็จ
- ✅ Receiver ไม่เห็น request อีก

---

## 👤 Guest Access

### TC-GUEST-001: Invite Guest via Link
**Prerequisite:** สร้าง published bill แล้ว
**Steps:**
1. เข้า bill view
2. คลิก "Share" หรือ "Invite"
3. ระบบสร้าง `/i/<token>` link
4. ส่ง link ไปให้ guest
5. Guest คลิก link (ไม่ต้องล็อกอิน)

**Expected Result:**
- ✅ Link สร้างสำเร็จ
- ✅ Guest กดได้โดยไม่ต้องล็อกอิน
- ✅ Guest เห็น bill details
- ✅ Guest สามารถจ่ายเงินได้

### TC-GUEST-002: Guest Join Bill & Select Participant Slot
**Prerequisite:** Guest ได้ invite link
**Steps:**
1. Click invite link
2. เลือกชื่อของตัวเอง (participant slot)
3. ใส่ชื่อและ email
4. คลิก "Join"

**Expected Result:**
- ✅ Guest session สร้างสำเร็จ
- ✅ Guest slot claimed
- ✅ Guest เห็นจำนวนเงินที่ต้องจ่าย
- ✅ Join timestamp บันทึก

### TC-GUEST-003: Guest Cannot Join Same Bill Twice
**Steps:**
1. Guest join bill โดยเลือก participant slot A
2. Guest ลองเลือก slot B ด้วยคนเดียวกัน

**Expected Result:**
- ✅ ระบบสกัดกั้น
- ✅ แสดง error "Cannot join twice"

### TC-GUEST-004: Guest Payment Flow
**Prerequisite:** Guest ได้เข้า bill
**Steps:**
1. Guest ดู bill detail
2. ทำการจ่ายเงิน (สมมุติว่าตัดรับขึ้นจน validate)
3. อัพโหลด slip (รูปหรือ OCR)

**Expected Result:**
- ✅ Payment marked as "paid"
- ✅ Slip ถูกบันทึก
- ✅ Timestamp บันทึก
- ✅ Bill owner เห็น payment update

---

## 💳 Payment System

### TC-PAYMENT-001: View Payment Status
**Prerequisite:** มี bill พร้อม participants
**Steps:**
1. เข้า bill detail
2. ดู participant list

**Expected Result:**
- ✅ แสดง "unpaid" / "paid" status
- ✅ Total paid vs Total due
- ✅ Payment date (ถ้าจ่ายแล้ว)

### TC-PAYMENT-002: Generate PromptPay QR Code
**Prerequisite:** User มี promptPayPhone ในโปรไฟล์, participant ต้องจ่ายเงิน
**Steps:**
1. เข้า bill
2. เลือก participant ที่ต้องจ่าย
3. คลิก "Pay with PromptPay"
4. ระบบสร้าง QR code

**Expected Result:**
- ✅ QR code สร้างสำเร็จ
- ✅ QR code เข้ารหัสจำนวนเงินถูก
- ✅ QR code เข้ารหัสเบอร์มือถือถูก
- ✅ สามารถสแกนด้วย mobile wallet

### TC-PAYMENT-003: Upload Payment Slip
**Prerequisite:** Participant ทำการจ่ายแล้ว
**Steps:**
1. เข้า bill detail
2. คลิก "Mark as Paid"
3. อัพโหลดรูป slip
4. ตรวจสอบ (verification)
5. คลิก "Confirm Payment"

**Expected Result:**
- ✅ Slip uploaded สำเร็จ
- ✅ รูป stored ใน Cloudinary
- ✅ Payment status เปลี่ยนเป็น "paid"
- ✅ Paid date บันทึก

### TC-PAYMENT-004: Payment Verification (Admin)
**Prerequisite:** Admin review bill
**Steps:**
1. Admin ไปที่ `/admin/bills`
2. เลือก bill
3. ดู participant slips
4. Approve หรือ Reject

**Expected Result:**
- ✅ Admin เห็น slip images
- ✅ สามารถ approve/reject
- ✅ Rejected payment กลับเป็น "unpaid"

### TC-PAYMENT-005: User Profile - Bank Account Setup
**Prerequisite:** User ล็อกอิน
**Steps:**
1. ไปที่ `/settings`
2. ดูส่วน "Bank Account"
3. แก้ไข ชื่อธนาคาร / account number
4. ทำการบันทึก

**Expected Result:**
- ✅ Bank info อัพเดท
- ✅ Visible ในหน้า bill (สำหรับ payer)

### TC-PAYMENT-006: PromptPay Phone Setup
**Steps:**
1. ไปที่ `/settings`
2. ใส่ เบอร์โทรศัพท์ PromptPay
3. บันทึก

**Expected Result:**
- ✅ Phone number บันทึก (optional field)
- ✅ QR code generation ทำงานได้

---

## 🔔 Notifications

### TC-NOTIF-001: Notification Creation
**Prerequisite:** Event occur (friend request, bill invite, payment)
**Steps:**
1. Event ทำให้เกิด
2. ตรวจสอบ notification

**Expected Result:**
- ✅ Notification สร้างใน database
- ✅ Notification bell ปรากฏบนหน้า UI
- ✅ Message ถูกต้อง

### TC-NOTIF-002: Mark Notification as Read
**Steps:**
1. คลิก notification bell
2. เห็น notification list
3. คลิก notification เพื่ออ่าน
4. คลิก "Mark as Read"

**Expected Result:**
- ✅ Notification status เปลี่ยนเป็น "read"
- ✅ Visual indicator เปลี่ยน (ไม่ bold หรือลบ dot)

### TC-NOTIF-003: Clear All Notifications
**Steps:**
1. คลิก notification bell
2. คลิก "Clear All"
3. ยืนยัน

**Expected Result:**
- ✅ Notifications ทั้งหมดลบ
- ✅ Bell ไม่แสดง badge

### TC-NOTIF-004: Notification Settings
**Prerequisite:** User ต้องการ control notifications
**Steps:**
1. ไปที่ `/settings` -> Notifications
2. Enable/Disable notification types:
   - Friend requests
   - Bill invites
   - Payment reminders
   - LINE notifications
3. บันทึก

**Expected Result:**
- ✅ Settings บันทึก
- ✅ Disabled notifications ไม่ส่ง
- ✅ Enabled notifications ส่งปกติ

### TC-NOTIF-005: Notification Delivery Channels
**Steps:**
1. ทำให้เกิด event
2. ตรวจสอบ:
   - ✅ UI notification ปรากฏ
   - ✅ Email ส่งถูกต้อง (ถ้าเปิด)
   - ✅ LINE message ส่งถูกต้อง (ถ้าเชื่อม)

**Expected Result:**
- ✅ Multi-channel delivery ทำงาน

---

## LINE Integration

### TC-LINE-001: Link LINE Account
**Prerequisite:** User มี LINE account
**Steps:**
1. ไปที่ `/settings`
2. ดูส่วน "LINE Account"
3. คลิก "Link LINE"
4. ติดตาม LINE OA authorization flow
5. ให้ permission

**Expected Result:**
- ✅ LINE User ID ได้รับ
- ✅ Linked at timestamp บันทึก
- ✅ LINE icon ปรากฏใน UI บอก linked

### TC-LINE-002: Check LINE Link Status
**Steps:**
1. ไปที่ `/settings`
2. ดูส่วน "LINE Status"

**Expected Result:**
- ✅ แสดง "Linked" ถ้า linked
- ✅ แสดง "Not Linked" ถ้า not linked
- ✅ แสดง linked date

### TC-LINE-003: Unlink LINE Account
**Prerequisite:** LINE account linked
**Steps:**
1. ไปที่ `/settings` -> LINE
2. คลิก "Unlink"
3. ยืนยัน

**Expected Result:**
- ✅ LINE account unlinked
- ✅ Status กลับเป็น "Not Linked"
- ✅ LINE messages ไม่ส่ง

### TC-LINE-004: LINE Notification Message
**Prerequisite:** LINE linked + notification enabled
**Steps:**
1. สร้าง bill + invite guest
2. Guest accepted
3. ตรวจสอบ LINE message

**Expected Result:**
- ✅ LINE message ส่งถูกต้อง
- ✅ Message content ถูกต้อง
- ✅ มี link ไปหน้า bill

### TC-LINE-005: LINE Notify Toggle
**Steps:**
1. ไปที่ `/settings`
2. Find "Enable LINE Notifications"
3. Toggle ON/OFF

**Expected Result:**
- ✅ Setting บันทึก
- ✅ Notifications ตามปิด/เปิด

---

## 📸 OCR Receipt Scanning

### TC-OCR-001: Upload Receipt Image
**Prerequisite:** Bill พร้อม, user ต้องจ่ายเงิน
**Steps:**
1. เข้า bill detail
2. คลิก "Pay" / "Upload Receipt"
3. เลือกรูปหลักฐานโอนเงิน
4. Upload

**Expected Result:**
- ✅ รูป upload สำเร็จ
- ✅ หลักฐาน verified = false (pending)
- ✅ รูป store ใน Cloudinary

### TC-OCR-002: OCR Processing
**Prerequisite:** Receipt uploaded
**Steps:**
1. ระบบประมวลผล OCR อัตโนมัติ
2. แยก: reference number, amount, timestamp

**Expected Result:**
- ✅ OCR ดึง metadata จากรูป
- ✅ Reference number บันทึก
- ✅ Amount สกัด (หากมี)
- ✅ Processing timestamp บันทึก

### TC-OCR-003: Admin Verify Receipt
**Prerequisite:** Receipt OCR processed
**Steps:**
1. Admin ไปที่ `/admin/bills`
2. เลือก bill
3. ดู participant receipt
4. Compare amount + reference number
5. คลิก "Verify" หรือ "Reject"

**Expected Result:**
- ✅ Admin เห็น OCR extracted data
- ✅ Verified flag update
- ✅ Verification date บันทึก
- ✅ Notify user ว่า verified

### TC-OCR-004: Receipt Verification Failure
**Steps:**
1. Admin ดู receipt
2. Data ไม่ตรง หรือ receipt ใช้ไม่ได้
3. คลิก "Reject"
4. ใส่ reason

**Expected Result:**
- ✅ Receipt rejected
- ✅ Payment mark as "unpaid" ใหม่
- ✅ User ได้รับ notification พร้อม reason

---

## 🏛️ Admin Features

### TC-ADMIN-001: Admin Dashboard Overview
**Prerequisite:** Admin account login
**Steps:**
1. ไปที่ `/admin`
2. ดู dashboard stats

**Expected Result:**
- ✅ Total users count
- ✅ Total bills count
- ✅ Pending payments count
- ✅ Recent activity log

### TC-ADMIN-002: Bills Management
**Steps:**
1. ไปที่ `/admin/bills`
2. ดู all bills

**Expected Result:**
- ✅ List all bills (published + draft)
- ✅ Filter by status
- ✅ Filter by payment status
- ✅ Search by bill name

### TC-ADMIN-003: View Bill Details & Receipts
**Steps:**
1. Admin ไปที่ `/admin/bills`
2. เลือก bill
3. ดู participants + receipts

**Expected Result:**
- ✅ ดู participant list
- ✅ ดู slip images
- ✅ ดู OCR data
- ✅ Verify/Reject slip

### TC-ADMIN-004: Users Management
**Steps:**
1. ไปที่ `/admin/users`
2. ดู user list

**Expected Result:**
- ✅ List all users
- ✅ ดู user details (name, email, role)
- ✅ ดู user activity

### TC-ADMIN-005: Activity Log
**Steps:**
1. ไปที่ `/admin/activity`
2. ดู audit logs

**Expected Result:**
- ✅ Show all actions (create bill, payment, friend request etc.)
- ✅ Filter by action type
- ✅ Filter by date range
- ✅ Show who did what when

---

## 🔒 Edge Cases & Security

### TC-SECURITY-001: SQL Injection Prevention
**Steps:**
1. ลอง input: `'; DROP TABLE users; --`
2. ลอง inject ใน search fields

**Expected Result:**
- ✅ Input sanitized
- ✅ Database ปกติ
- ✅ Error message ปกติ

### TC-SECURITY-002: XSS Prevention
**Steps:**
1. ลอง input: `<script>alert('XSS')</script>` ใน bill name
2. ลอง input: `<img src=x onerror="alert('XSS')">` ใน participant name

**Expected Result:**
- ✅ Script ไม่ execute
- ✅ Input escaped correctly
- ✅ HTML entities แสดง

### TC-SECURITY-003: Authorization Check
**Prerequisite:** User A สร้าง bill
**Steps:**
1. User B พยายาม edit bill ของ A (ผ่าน URL manipulation)
2. User B พยายาม delete bill ของ A

**Expected Result:**
- ✅ ระบบ reject (403 Forbidden)
- ✅ Error message แสดง
- ✅ Audit log บันทึก unauthorized attempt

### TC-SECURITY-004: Session Hijacking Prevention
**Steps:**
1. ล็อกอินด้วย account A
2. Copy session cookie
3. ล็อกออก
4. ลองใช้ cookie เดิมเพื่อเข้า

**Expected Result:**
- ✅ Session invalid
- ✅ Redirect ไปหน้า login

### TC-SECURITY-005: CSRF Protection
**Steps:**
1. สร้าง bill โดยทำ POST request
2. ทำการ request โดยไม่มี CSRF token

**Expected Result:**
- ✅ Request reject (403)
- ✅ ต้องมี valid CSRF token

### TC-SECURITY-006: Rate Limiting
**Steps:**
1. ส่ง friend request ซ้ำ ๆ ด่วน (10+ ครั้ง)
2. ส่ง login attempts หลายครั้ง

**Expected Result:**
- ✅ ถูก rate limit หลังจาก N attempts
- ✅ 429 Too Many Requests
- ✅ Cooldown period ก่อนลองใหม่

### TC-SECURITY-007: Payment Amount Tampering
**Prerequisite:** Bill ready to pay
**Steps:**
1. Open browser dev tools
2. ลองแก้ไข amount ใน form field
3. ส่ง payment

**Expected Result:**
- ✅ Server ตรวจสอบ amount จาก database
- ✅ Tampering detected
- ✅ Payment reject

### TC-SECURITY-008: Guest Cannot Access Admin Panel
**Prerequisite:** Guest access bill
**Steps:**
1. Guest ลองเข้า `/admin` ด้วยการแก้ URL
2. Guest ลองเข้า `/admin/bills`

**Expected Result:**
- ✅ ถูก redirect หรือ 403
- ✅ Guest ไม่มี admin access

---

## 📊 Performance & Edge Cases

### TC-PERF-001: Large Bill with Many Participants
**Steps:**
1. สร้าง bill กับ 50+ participants
2. Load bill page

**Expected Result:**
- ✅ Page load ใน reasonable time (< 2 sec)
- ✅ UI ไม่ lag
- ✅ Calculations ถูกต้อง

### TC-PERF-002: Large Number of Bills
**Steps:**
1. User มี 100+ bills
2. Load `/dashboard`
3. Load bills list with pagination

**Expected Result:**
- ✅ Pagination ทำงาน
- ✅ Load time reasonable
- ✅ Database query optimize (indexed)

### TC-EDGE-001: Zero Amount Bill
**Steps:**
1. สร้าง bill กับ total 0 บาท
2. เพิ่ม participants

**Expected Result:**
- ✅ System handle gracefully
- ✅ ไม่ crash
- ✅ แสดง 0.00 บาท

### TC-EDGE-002: Rounding Issues
**Steps:**
1. สร้าง bill 100 บาท split 3 คน equal
2. ตรวจสอบ amount: 33.33 + 33.33 + 33.34

**Expected Result:**
- ✅ Rounding ทำให้ total ตรง
- ✅ Precision ถูกต้อง (decimal places)

### TC-EDGE-003: Circular Friend Relationships
**Steps:**
1. A -> B friend request
2. B -> A friend request (ก่อน A accept)
3. Handle conflict

**Expected Result:**
- ✅ System handle ได้
- ✅ ไม่ create duplicate
- ✅ Friendship เกิดขึ้น

### TC-EDGE-004: Concurrent Payments
**Steps:**
1. Participant A + B ทำ payment พร้อมกัน
2. Verify both marked as paid

**Expected Result:**
- ✅ ไม่มี race condition
- ✅ ทั้ง 2 status update ถูก
- ✅ Database consistency

### TC-EDGE-005: Bill Link Sharing
**Steps:**
1. Owner คัดลอก invite link ซ้ำ ๆ
2. ส่งให้คน A, B, C
3. ทุกคนเข้า link พร้อมกัน

**Expected Result:**
- ✅ Link ทำงานทั้ง 3 คน
- ✅ แต่ละคน claim slot เป็นคนละคน
- ✅ ไม่ conflict

---

## 🧪 Testing Checklist

### Before Presentation
- [ ] ทั้ง 8 auth flows ทดสอบ
- [ ] สร้าง bill 3 types (equal, percent, separate) สำเร็จ
- [ ] Friend system (add, accept, reject, remove) ทำงาน
- [ ] Guest access และ payment flow ทำงาน
- [ ] Notifications เข้าถึง (UI + Email/LINE)
- [ ] Admin dashboard ทำงาน
- [ ] 5+ security checks ผ่าน
- [ ] Payment PromptPay QR ทำงาน
- [ ] Receipt upload + OCR ทำงาน
- [ ] No console errors

### Performance Check
- [ ] Dashboard load < 2 sec
- [ ] Bill list load < 2 sec
- [ ] Bill detail load < 1.5 sec
- [ ] No memory leaks

### Cross-Browser Testing (Optional)
- [ ] Chrome ✓
- [ ] Firefox ✓
- [ ] Safari ✓
- [ ] Mobile (iOS Safari / Chrome) ✓

---

## 📝 Notes for Presentation

1. **Demo Data Setup:** เตรียม 3-4 test accounts พร้อม bills ที่ published
2. **Backup Plan:** เตรียม screenshot/video ของ features ที่ complex
3. **Error Scenarios:** เตรียม handle gracefully (show error message)
4. **Performance Story:** ตรวจ Network tab ว่า API ทำงานเร็ว
5. **Mobile Demo:** ทดสอบ mobile responsive ด้วย

---

## 🎯 Success Metrics
- ✅ 0 Critical bugs
- ✅ 0 Unhandled errors
- ✅ All main flows ทำงาน (auth, bill, payment)
- ✅ All notifications deliver
- ✅ Performance < 2 sec page load

**Good luck with your presentation! 🚀**
