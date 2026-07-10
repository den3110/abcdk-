/**
 * PickleMark — logo PickleTour: pinwheel 4 cánh hình học PHẲNG trong bounds VUÔNG 40×40,
 * một màu brand, không ô nền. Cánh mập + chấm "quả bóng" ở tâm cho có điểm nhấn.
 */
export default function PickleMark({ size = 34, color = "var(--color-brand, #3D87FF)" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="PickleTour"
      style={{ display: "block", flex: "none", color }}
      fill="currentColor"
    >
      <g transform="translate(20 20)">
        {[45, 135, 225, 315].map((deg) => (
          <g key={deg} transform={`rotate(${deg})`}>
            <rect x="-6.4" y="-19.5" width="12.8" height="16.6" rx="6.4" />
          </g>
        ))}
        <circle cx="0" cy="0" r="4.6" />
      </g>
    </svg>
  );
}
