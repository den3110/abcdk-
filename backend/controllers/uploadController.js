export const uploadCccd = async (req, res) => {
  if (!req.files || !req.files.front || !req.files.back)
    return res.status(400).json({ message: "Thiếu file ảnh" });

  const { front, back } = req.files;
  const urls = {
    front: `/${front[0].path.replace("\\", "/")}`,
    back : `/${back[0].path.replace("\\", "/")}`,
  };

  req.user.cccdImages = urls;
  req.user.cccdStatus = "pending";
  await req.user.save();

  res.status(201).json({
    message: "Upload thành công, đang chờ xác minh",
    cccdImages: urls,
    cccdStatus: "pending",
  });
};