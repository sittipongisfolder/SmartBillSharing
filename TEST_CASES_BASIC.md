# SmartBill Basic Test Cases (Normal Flow)

เป้าหมาย: ชุดทดสอบพื้นฐานตามโฟลใช้งานจริง สำหรับซ้อมก่อนพรีเซนต์
จำนวนทั้งหมด: 36 Test Cases

## วิธีใช้
1. รันทดสอบตามลำดับ TC-001 ถึง TC-036
2. ถ้าเคสใดไม่ผ่าน ให้หยุดและแก้ก่อนค่อยไปต่อ
3. เก็บหลักฐานด้วย screenshot เฉพาะเคสสำคัญ

---

## A) Authentication And Entry Flow

### TC-001 Register New User
Prerequisite: ไม่มีอีเมลนี้ในระบบ
Steps:
1. เปิดหน้า Register
2. กรอกชื่อ อีเมล รหัสผ่าน และยืนยันรหัสผ่าน
3. กรอกข้อมูลธนาคาร
4. กดสมัครสมาชิก
Expected:
- สมัครสำเร็จ
- ระบบพาไปหน้า Login

### TC-002 Register With Duplicate Email
Prerequisite: มีอีเมลนี้อยู่แล้ว
Steps:
1. เปิดหน้า Register
2. กรอกอีเมลเดิม
3. กดสมัครสมาชิก
Expected:
- ระบบไม่ยอมให้สมัครซ้ำ
- แสดงข้อความแจ้งเตือนชัดเจน

### TC-003 Login Success
Prerequisite: มีบัญชีผู้ใช้แล้ว
Steps:
1. เปิดหน้า Login
2. กรอกอีเมลและรหัสผ่านถูกต้อง
3. กดเข้าสู่ระบบ
Expected:
- เข้าสู่ระบบสำเร็จ
- ไปหน้า Dashboard

### TC-004 Login Fail
Steps:
1. เปิดหน้า Login
2. กรอกรหัสผ่านผิด
3. กดเข้าสู่ระบบ
Expected:
- เข้าสู่ระบบไม่สำเร็จ
- แสดงข้อความผิดพลาด

### TC-005 Forgot Password Basic
Prerequisite: มีอีเมลในระบบ
Steps:
1. เปิดหน้า Forgot Password
2. กรอกอีเมล
3. ส่งคำขอรีเซ็ตรหัสผ่าน
Expected:
- ระบบตอบรับคำขอ
- มีลิงก์รีเซ็ต (อีเมลหรือ log ในโหมด dev)

### TC-006 Logout
Prerequisite: ล็อกอินอยู่
Steps:
1. กด Logout
Expected:
- ออกจากระบบสำเร็จ
- เข้า protected page โดยตรงไม่ได้

---

## B) Profile And Settings

### TC-007 View Profile Settings
Prerequisite: ล็อกอินแล้ว
Steps:
1. เปิดหน้า Settings
Expected:
- เห็นข้อมูลโปรไฟล์และข้อมูลธนาคาร

### TC-008 Update Bank Information
Prerequisite: ล็อกอินแล้ว
Steps:
1. เปิดหน้า Settings
2. แก้ไขธนาคารและเลขบัญชี
3. กดบันทึก
Expected:
- บันทึกสำเร็จ
- รีเฟรชแล้วยังเป็นค่าที่แก้ไข

### TC-009 Update PromptPay Phone
Prerequisite: ล็อกอินแล้ว
Steps:
1. เปิดหน้า Settings
2. กรอกเบอร์ PromptPay
3. กดบันทึก
Expected:
- บันทึกสำเร็จ
- ใช้งาน QR Payment ได้ในเคสจ่ายเงินจริง

---

## C) Friend Flow (Normal)

### TC-010 Send Friend Request
Prerequisite: มีผู้ใช้อีกบัญชีหนึ่ง
Steps:
1. เปิดหน้า Friends
2. ค้นหาอีเมลเพื่อน
3. กด Add Friend
Expected:
- ส่งคำขอสำเร็จ
- สถานะเป็น Pending

### TC-011 Receiver Sees Friend Request
Prerequisite: มีคำขอเข้ามาแล้ว
Steps:
1. ล็อกอินบัญชีผู้รับ
2. เปิดหน้า Friends หรือ Notifications
Expected:
- เห็นคำขอเป็นรายการรอดำเนินการ

### TC-012 Accept Friend Request
Prerequisite: มีคำขอค้างอยู่
Steps:
1. กด Accept
Expected:
- กลายเป็นเพื่อนกันทั้งสองฝั่ง
- รายชื่อเพื่อนอัปเดตทันที

### TC-013 Reject Friend Request
Prerequisite: ส่งคำขอใหม่อีกครั้ง
Steps:
1. ฝั่งผู้รับกด Reject
Expected:
- คำขอหายจากรายการรอ
- ไม่เกิดความสัมพันธ์เพื่อน

### TC-014 Remove Friend
Prerequisite: เป็นเพื่อนกันแล้ว
Steps:
1. เปิดหน้า Friends
2. กด Remove ที่เพื่อนคนนั้น
Expected:
- ลบเพื่อนสำเร็จ
- ทั้งสองฝั่งไม่เห็นกันในรายชื่อเพื่อน

---

## D) Bill Main Flow (Create To Publish)

### TC-015 Create Bill Equal Split
Prerequisite: ล็อกอินแล้ว
Steps:
1. เปิดหน้าสร้างบิลแบบ Equal
2. ใส่ชื่อบิลและรายการอาหาร
3. เพิ่มผู้ร่วมจ่าย 3 คน
4. กดสร้างบิล
Expected:
- สร้างบิลสำเร็จสถานะ Draft
- ยอดหารเท่าถูกต้อง

### TC-016 Create Bill Percent Split
Prerequisite: ล็อกอินแล้ว
Steps:
1. เปิดหน้าสร้างบิลแบบ Percent
2. ใส่ยอดรวม
3. ใส่เปอร์เซ็นต์ผู้ร่วมจ่ายให้รวม 100
4. กดสร้างบิล
Expected:
- สร้างสำเร็จ
- ยอดแต่ละคนตรงตามเปอร์เซ็นต์

### TC-017 Create Bill Separate Item Split
Prerequisite: ล็อกอินแล้ว
Steps:
1. เปิดหน้าสร้างบิลแบบ Separated
2. เพิ่ม item หลายรายการ
3. กำหนดคนรับผิดชอบแต่ละ item
4. กดสร้างบิล
Expected:
- สร้างสำเร็จ
- ยอดต่อคนคำนวณถูกต้อง

### TC-018 Validate Percent Must Equal 100
Prerequisite: อยู่หน้าสร้างบิล Percent
Steps:
1. ใส่เปอร์เซ็นต์รวมไม่เท่ากับ 100
2. กดสร้างบิล
Expected:
- ระบบไม่ให้สร้าง
- แจ้งเตือนให้ปรับเปอร์เซ็นต์

### TC-019 Edit Draft Bill
Prerequisite: มี Draft bill
Steps:
1. เปิด Draft bill
2. แก้ชื่อบิลหรือแก้รายการ
3. กดบันทึก
Expected:
- บันทึกสำเร็จ
- ข้อมูลใหม่ถูกแสดง

### TC-020 Delete Draft Bill
Prerequisite: มี Draft bill
Steps:
1. เปิด Draft bill
2. กด Delete และยืนยัน
Expected:
- ลบสำเร็จ
- ไม่สามารถเปิดบิลเดิมได้

### TC-021 Publish Bill
Prerequisite: มี Draft bill ที่ข้อมูลครบ
Steps:
1. เปิด Draft bill
2. กด Publish
Expected:
- สถานะเปลี่ยนเป็น Published
- พร้อมแชร์ลิงก์เชิญ

### TC-022 Generate Invite Link
Prerequisite: Bill เป็น Published
Steps:
1. เปิดหน้าบิล
2. กด Share/Invite
Expected:
- ได้ลิงก์เชิญใช้งานได้จริง

### TC-023 View Bill Detail
Prerequisite: มีบิล Published
Steps:
1. เปิดหน้ารายละเอียดบิล
Expected:
- เห็นยอดรวม รายการ ผู้ร่วมจ่าย และสถานะชำระครบ

### TC-024 Prevent Unauthorized Bill Access
Prerequisite: มีผู้ใช้คนอื่นที่ไม่เกี่ยวข้องกับบิล
Steps:
1. ล็อกอินผู้ใช้ที่ไม่เกี่ยวข้อง
2. เปิด URL บิลโดยตรง
Expected:
- ระบบปฏิเสธการเข้าถึง

---

## E) Guest Flow (Invite To Join)

### TC-025 Guest Open Invite Link
Prerequisite: มี invite link จากบิล Published
Steps:
1. เปิดลิงก์เชิญใน browser ใหม่
Expected:
- เปิดหน้า guest access ได้
- ไม่ต้องล็อกอินแบบผู้ใช้ปกติ

### TC-026 Guest Join Participant Slot
Prerequisite: เปิด invite link แล้ว
Steps:
1. เลือก slot ผู้ร่วมจ่าย
2. กรอกชื่อ/อีเมล guest
3. กด Join
Expected:
- เข้าร่วมสำเร็จ
- slot ถูก claim

### TC-027 Guest Cannot Claim Same Bill Twice
Prerequisite: guest claim slot แล้ว
Steps:
1. พยายาม claim อีก slot ในบิลเดิม
Expected:
- ระบบไม่อนุญาต
- แจ้งข้อผิดพลาดชัดเจน

### TC-028 Guest View Amount Due
Prerequisite: guest join สำเร็จ
Steps:
1. เปิดหน้าบิลของ guest
Expected:
- เห็นยอดที่ต้องจ่ายของตัวเองถูกต้อง

### TC-029 Guest Cannot Access Admin Pages
Prerequisite: เป็น guest session
Steps:
1. เปิดหน้า admin
Expected:
- ถูก block หรือ redirect

---

## F) Payment Flow (Normal)

### TC-030 Show Payment Status Unpaid
Prerequisite: มี participant ที่ยังไม่จ่าย
Steps:
1. เปิดหน้ารายละเอียดบิล
Expected:
- แสดงสถานะ unpaid ถูกต้อง

### TC-031 Generate PromptPay QR
Prerequisite: เจ้าของบิลมีข้อมูล PromptPay
Steps:
1. ผู้จ่ายเลือกช่องทาง PromptPay
2. เปิด QR
Expected:
- QR แสดงผลได้
- ยอดเงินตรงกับที่ต้องจ่าย

### TC-032 Upload Slip
Prerequisite: มีขั้นตอนจ่ายเงินแล้ว
Steps:
1. กดอัปโหลดสลิป
2. เลือกรูป
3. ส่งข้อมูล
Expected:
- อัปโหลดสำเร็จ
- เห็นสลิปในหน้าบิล

### TC-033 Mark Payment As Paid
Prerequisite: อัปโหลดสลิปสำเร็จ
Steps:
1. ยืนยันการจ่ายเงิน
Expected:
- สถานะ participant เปลี่ยนเป็น paid
- มีเวลาบันทึกการจ่าย

### TC-034 Owner Sees Payment Update
Prerequisite: มี participant จ่ายเงินแล้ว
Steps:
1. เจ้าของบิลเปิดหน้าบิล
Expected:
- เห็นสถานะล่าสุดของผู้จ่ายทันที

---

## G) Notification Basic Flow

### TC-035 Notification Appears On Event
Prerequisite: เกิดเหตุการณ์ เช่น friend request หรือมีคนจ่ายเงิน
Steps:
1. ทำ action ที่ควรมีแจ้งเตือน
2. เปิดกระดิ่งแจ้งเตือน
Expected:
- มีรายการแจ้งเตือนใหม่
- ข้อความสื่อความหมายถูกต้อง

### TC-036 Mark Notification As Read
Prerequisite: มีแจ้งเตือนค้างอ่าน
Steps:
1. เปิดรายการแจ้งเตือน
2. กด Mark as Read
Expected:
- สถานะเปลี่ยนเป็นอ่านแล้ว
- badge ลดลง/หายตามจำนวน

---

## Exit Criteria (Basic)

ผ่านการซ้อมแบบพื้นฐาน เมื่อ:
- ผ่านอย่างน้อย 34 จาก 36 เคส
- ไม่มีเคสล้มในหมวด Authentication, Bill Create/Publish, Guest Join, Payment
- ไม่มี error แดงใน console ระหว่างโฟลหลัก
