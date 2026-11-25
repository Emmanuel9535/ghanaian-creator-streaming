type BrandMarkProps = {
  size?: "sidebar" | "header";
};

export function BrandMark({ size = "header" }: BrandMarkProps) {
  const classes = size === "sidebar"
    ? "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--yellow)] text-lg font-black text-[var(--teal-dark)]"
    : "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--yellow)] font-black text-[var(--teal-dark)]";

  return <span aria-hidden="true" className={classes}>M</span>;
}
