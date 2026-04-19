# SmartBill - Quick Reference Card 🎯
**ใช้ระหว่าง Presentation - Print out!**

---

## 🚀 Demo Flow (10 minutes)

### ⏱️ Min 0-1: Setup
```
✓ Open localhost:3000
✓ Clear cookies if needed
✓ Open DevTools (F12) to watch Network
```

### ⏱️ Min 1-2: Auth
```
1. Login with: owner@test.com / Test1234!
2. Point: "Secure authentication with NextAuth"
3. Show: Dashboard loads
```

### ⏱️ Min 2-5: Bill Creation
```
1. Create → "Equal Split"
2. Add items:
   - Pad Thai 300
   - Som Tam 250
   - Rice 50
   = 600 บาท ÷ 3 people = 200 each
3. Point: "Flexible split options - equal, percentage, per-item"
```

### ⏱️ Min 5-7: Payment & Invite
```
1. Publish Bill
2. Show invite link: /i/<token>
3. Open new tab (private window)
4. Guest joins & selects name
5. Guest sees: "You owe 200 บาท"
6. Click "Pay with PromptPay"
7. Point: "QR code integrates with mobile wallets"
```

### ⏱️ Min 7-9: Friends & Admin
```
1. Back to owner tab
2. Go to /friends
3. Show: "Add Friend" → search → pending → Accept
4. Go to /admin (if authorized)
5. Point: "Admin can verify payments & manage users"
```

### ⏱️ Min 9-10: Recap
```
✓ Created bill
✓ Invited guest
✓ Tracked payment
✓ Admin verified
= Smart bill splitting! 🎉
```

---

## 💡 Key Talking Points

| Feature | How | Why |
|---------|-----|-----|
| **Multiple Split Types** | equal / percent / per-item | Works for any scenario |
| **PromptPay Integration** | Click → QR generated | Mobile-first payment |
| **Guest Access** | Link-based, no login needed | Frictionless for non-users |
| **Payment Verification** | Admin reviews receipts | Accountability |
| **Notifications** | UI + Email + LINE | Multi-channel updates |
| **Role-Based** | User / Admin / Guest | Secure permission model |

---

## 🆘 Quick Troubleshooting

| Problem | Fix |
|---------|-----|
| Page won't load | Ctrl+Shift+R (force refresh) |
| Already logged in | Ctrl+Shift+Delete (clear cookies) |
| Numbers wrong | Refresh (F5) |
| Image upload fails | Check Network tab for 413 error |
| Database error | Restart: `npm run dev` |
| Email not sending (dev) | Check terminal for reset link |

---

## ✨ Impressive Demo Moments

🌟 **Moment 1:** Generate PromptPay QR on screen
```
"This QR encodes: amount + phone number in PromptPay format"
```

🌟 **Moment 2:** Show bill calculation is correct
```
"It handles rounding properly: 3 people → 200 + 200 + 200 = 600 ✓"
```

🌟 **Moment 3:** Real-time notification
```
"Guest paid → Bill owner gets notification instantly"
```

🌟 **Moment 4:** Admin verification
```
"Admin can see all payments, approve receipts, track audit logs"
```

---

## 📊 Key Numbers to Mention

- **100+ Test Cases** covering auth, bills, payments, friends, admin
- **3 Bill Split Types:** equal, percentage, per-item
- **3 Payment Channels:** UI, Email, LINE Notify
- **10 Security Checks:** CSRF, XSS, SQL injection, authorization, etc.
- **5 Admin Features:** Dashboard, bills, users, activity, receipts
- **< 2 sec Page Load** time (performance optimized)

---

## 🎤 Backup Responses

**Q: "Does it work on mobile?"**
- A: "Yes, it's responsive. Let me toggle device mode..." (Ctrl+Shift+M)

**Q: "What if the link is shared multiple times?"**
- A: "Each guest can join once. System prevents duplicate claims."

**Q: "How secure is it?"**
- A: "Password hashing, session management, CSRF protection, authorization checks..."

**Q: "What happens if payment fails?"**
- A: "Bill shows unpaid. Guest can retry. Admin is notified."

**Q: "Can guests bypass payment?"**
- A: "No, bill shows amount owed. Admin verifies receipts before approval."

---

## 📱 Browser Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| F12 | Open DevTools (close before demo) |
| Ctrl+Shift+M | Toggle mobile view |
| Ctrl+Shift+R | Force refresh (clear cache) |
| Ctrl+L | Focus address bar |
| Tab | Switch browser tabs |
| F5 | Refresh page |

---

## 🎬 Order of Pages to Visit

```
1. localhost:3000 → login
2. /dashboard → bills list
3. /open-bill/create-equal → create bill
4. /bills/[billId] → view bill
5. /bills/[billId]/pay → show PromptPay QR
6. /i/[token] → guest access (new tab)
7. /friends → show friend system
8. /admin → admin dashboard
9. /settings → show profile/notifications
```

---

## ⏰ Time Management

- **Don't go over 10 min** (presentation time is tight)
- **Skip if low time:**
  - ❌ LINE integration details
  - ❌ OCR receipt scanning process
  - ❌ Security deep dive
- **Must include:**
  - ✅ Bill creation
  - ✅ Payment flow
  - ✅ Guest access
  - ✅ Admin dashboard

---

## 🔥 Energy Tips

- **Speak with confidence** - you know this app!
- **Pause after key features** - let people absorb
- **Make eye contact** - engage the audience
- **Have water nearby** - stay hydrated
- **Take a breath** - you're prepared! 💪

---

## 📋 Pre-Demo Checklist (5 min before)

```
SERVER & DB
☑ npm run dev running
☑ No red console errors
☑ MongoDB connected
☑ Localhost:3000 loads

TEST DATA
☑ Logged in as owner
☑ Have bills created
☑ 2nd browser tab ready (for guest demo)

BROWSER
☑ DevTools closed (F12 off)
☑ Zoom at 100% (Ctrl+0)
☑ Full screen ready
☑ Cache cleared

CONFIDENCE
☑ Know the 10-min flow
☑ Can explain features
☑ Know troubleshooting steps
☑ Backup plan ready
```

---

## 🎯 Success Criteria

After demo, people should say:

✅ "Oh, I understand how bills split now"
✅ "Payment tracking looks easy"
✅ "Admin dashboard is useful"
✅ "The app is responsive"
✅ "Security seems solid"

**If they say all 5 → Demo succeeded! 🎉**

---

## 🆘 Nuclear Option (If Everything Fails)

**Show Screenshots:**
1. Dashboard with bills
2. Bill detail with participants
3. PromptPay QR
4. Payment history
5. Admin dashboard

**Plus Narration:**
"The system manages all bill splitting workflows with a clean UI, secure payments, 
and admin oversight. Notifications keep everyone updated in real-time."

---

**YOU GOT THIS! Present with confidence! 🚀**

*Refer to TEST_CASES.md for detailed test cases*
*Refer to TEST_EXECUTION_GUIDE.md for full execution plan*
