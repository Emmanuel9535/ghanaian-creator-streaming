type BrandMarkProps = {
  size?: "auth" | "sidebar" | "header";
};

export function BrandMark({ size = "header" }: BrandMarkProps) {
  const classes = size === "auth"
    ? "grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-[var(--teal-dark)] text-2xl font-black text-[var(--yellow)] shadow-[0_5px_0_#ffcb05]"
    : size === "sidebar"
      ? "grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-[var(--teal-dark)] text-lg font-black text-[var(--yellow)] shadow-[0_4px_0_#ffcb05]"
      : "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-[var(--teal-dark)] font-black text-[var(--yellow)] shadow-[0_3px_0_#ffcb05]";

  return <span aria-hidden="true" className={classes}>M</span>;
}
