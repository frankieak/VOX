interface VoyLogoProps {
  className?: string;
}

export function VoyLogo({ className = "h-8 w-8" }: VoyLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M24 46C24 46 9 30.2 9 19a15 15 0 0 1 30 0c0 11.2-15 27-15 27z"
        fill="#16A34A"
      />
      <ellipse cx="24" cy="15.2" rx="10.5" ry="2.4" fill="#0A0F0D" />
      <path
        d="M17.6 15.2C17.6 9.6 20 7.6 24 7.6s6.4 2 6.4 7.6z"
        fill="#0A0F0D"
      />
    </svg>
  );
}
