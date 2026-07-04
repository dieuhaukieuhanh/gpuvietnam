import { brand } from '@/lib/constants';
import { footerLinks } from '@/lib/navigation';

export default function PublicFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-links">
          {footerLinks.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
        <p className="copyright">
          {brand.copyright} | {brand.email} | Zalo: {brand.zalo}
        </p>
      </div>
    </footer>
  );
}
