// components/PlayerName.jsx
// Render tên VĐV có áp "hiệu ứng tên" (màu / gradient / cầu vồng động) do admin cấu hình.
// Dùng chung cho cả UI v1 (MUI) lẫn v2 (Astryx shadow DOM) — chỉ dùng inline style.
//
// Cách dùng phổ biến (đặt BÊN TRONG phần tử chữ có sẵn để kế thừa font):
//   <Typography><PlayerName user={u} /></Typography>
//   <PlayerName user={u} name={computedName} />       // khi đã có sẵn chuỗi tên
//   <PlayerName user={u} component="span" onClick={...} />
import React, { useMemo } from "react";
import { useGetNameStylesQuery } from "../slices/nameStyleApiSlice";
import { buildNameStyleCss, resolveNameStyle } from "../utils/nameStyle";
import { getPlayerDisplayName } from "../utils/matchDisplay";

export default function PlayerName({
  user,
  player,
  name,
  nickname,
  source,
  mode, // "nickname" | "fullName" (nếu không truyền source)
  component: Comp = "span",
  style,
  className,
  children,
  ...rest
}) {
  // Bản đồ hiệu ứng dùng chung (RTK dedupe -> chỉ 1 request cho toàn app)
  const { data: map } = useGetNameStylesQuery(undefined, {
    refetchOnMountOrArgChange: false,
  });

  const target = user || player || null;

  // 1) Xác định chuỗi tên hiển thị
  let text = children ?? name ?? null;
  if (text == null) {
    if (target) {
      const src = source || (mode ? { nameDisplayMode: mode } : undefined);
      text = getPlayerDisplayName(target, src) || nickname || "";
    } else {
      text = nickname || "";
    }
  }

  // 2) Tra hiệu ứng
  const css = useMemo(() => {
    const ns = resolveNameStyle(map, target, { nickname: nickname || name });
    return ns ? buildNameStyleCss(ns) : null;
  }, [map, target, nickname, name]);

  const finalStyle = css?.style ? { ...css.style, ...(style || null) } : style;

  return (
    <Comp className={className || undefined} style={finalStyle} {...rest}>
      {text}
    </Comp>
  );
}
