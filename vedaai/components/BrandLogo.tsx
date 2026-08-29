type BrandLogoProps = {
  className?: string;
};

export function BrandLogo({ className = "" }: BrandLogoProps) {
  return (
    <img
      src="/veda-logo.png"
      alt=""
      width={32}
      height={32}
      className={`h-8 w-8 shrink-0 rounded-sm object-cover ${className}`.trim()}
    />
  );
}
