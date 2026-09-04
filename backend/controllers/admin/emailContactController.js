// controllers/admin/emailContactController.js
// Quản lý danh sách khách hàng (tệp email) để gửi chiến dịch.
import asyncHandler from "express-async-handler";
import EmailContactList from "../../models/emailContactListModel.js";
import EmailContact from "../../models/emailContactModel.js";
import { isValidEmail } from "../../services/emailCampaignService.js";

async function recountList(listId) {
  const count = await EmailContact.countDocuments({ list: listId });
  await EmailContactList.findByIdAndUpdate(listId, { $set: { contactCount: count } });
  return count;
}

// POST /admin/email-contact-lists
export const createList = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400);
    throw new Error("Nhập tên danh sách.");
  }
  const list = await EmailContactList.create({
    name,
    description: String(req.body?.description || "").trim(),
    source: String(req.body?.source || "").trim(),
    createdBy: req.user?._id || null,
  });
  res.status(201).json(list);
});

// GET /admin/email-contact-lists
export const listLists = asyncHandler(async (req, res) => {
  const items = await EmailContactList.find().sort({ createdAt: -1 }).lean();
  res.json({ items });
});

// GET /admin/email-contact-lists/:id
export const getList = asyncHandler(async (req, res) => {
  const list = await EmailContactList.findById(req.params.id).lean();
  if (!list) {
    res.status(404);
    throw new Error("Không tìm thấy danh sách.");
  }
  const optOut = await EmailContact.countDocuments({ list: list._id, optOut: true });
  res.json({ ...list, optOutCount: optOut });
});

// DELETE /admin/email-contact-lists/:id
export const deleteList = asyncHandler(async (req, res) => {
  await EmailContact.deleteMany({ list: req.params.id });
  await EmailContactList.findByIdAndDelete(req.params.id);
  res.json({ ok: true, _id: req.params.id });
});

// POST /admin/email-contact-lists/:id/contacts   body: { contacts: [{email,name,avatar,phone,extId}] }
export const addContacts = asyncHandler(async (req, res) => {
  const list = await EmailContactList.findById(req.params.id);
  if (!list) {
    res.status(404);
    throw new Error("Không tìm thấy danh sách.");
  }
  const rows = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  if (!rows.length) {
    res.status(400);
    throw new Error("Không có liên hệ nào.");
  }

  let invalid = 0;
  const seen = new Set();
  const ops = [];
  for (const r of rows) {
    const email = String(r?.email || "").trim().toLowerCase();
    if (!isValidEmail(email) || seen.has(email)) {
      if (!isValidEmail(email)) invalid += 1;
      continue;
    }
    seen.add(email);
    ops.push({
      updateOne: {
        filter: { list: list._id, email },
        update: {
          $set: {
            name: String(r?.name || "").trim(),
            avatar: String(r?.avatar || "").trim(),
            phone: String(r?.phone || "").trim(),
            extId: String(r?.extId || "").trim(),
          },
          $setOnInsert: { list: list._id, email },
        },
        upsert: true,
      },
    });
  }

  let added = 0;
  let updated = 0;
  if (ops.length) {
    const result = await EmailContact.bulkWrite(ops, { ordered: false });
    added = result.upsertedCount || 0;
    updated = result.modifiedCount || 0;
  }
  const total = await recountList(list._id);

  res.json({
    ok: true,
    received: rows.length,
    added,
    updated,
    duplicatesInFile: rows.length - seen.size - invalid,
    invalid,
    total,
  });
});

// GET /admin/email-contact-lists/:id/contacts?page&q&status
export const listContacts = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const filter = { list: req.params.id };
  if (req.query.status === "optout") filter.optOut = true;
  if (req.query.q) {
    const rx = new RegExp(
      String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
    filter.$or = [{ email: rx }, { name: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    EmailContact.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    EmailContact.countDocuments(filter),
  ]);
  res.json({ items, page, limit, total });
});

// DELETE /admin/email-contact-lists/:id/contacts/:contactId
export const deleteContact = asyncHandler(async (req, res) => {
  await EmailContact.deleteOne({ _id: req.params.contactId, list: req.params.id });
  const total = await recountList(req.params.id);
  res.json({ ok: true, total });
});
