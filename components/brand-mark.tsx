type BrandMarkProps = {
  size?: "sm" | "md";
};

export function BrandMark({ size = "md" }: BrandMarkProps) {
  const dimensions = size === "sm" ? "h-9 w-9 rounded-lg text-base" : "h-10 w-10 rounded-xl text-lg";

  return (
    <span
      aria-hidden="true"
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-[#075779] pb-1 font-black text-[#ffcc00] ${dimensions}`}
    >
      M
      <span className="absolute inset-x-0 bottom-0 h-1.5 bg-[#ffcc00]" />
    </span>
  );
}
