import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HTML_DIR = path.join(ROOT, '..');

const PAGE_MAP = [
  { file: 'Trang chu.html', route: 'index', slug: 'trang-chu', component: 'TrangChuPage' },
  { file: 'About us.html', route: 'about', slug: 'about-us', component: 'AboutUsPage' },
  { file: 'Dieu khoan dich vu.html', route: 'dieu-khoan-dich-vu', slug: 'dieu-khoan-dich-vu', component: 'DieuKhoanPage' },
  { file: 'Chinh sach bao mat.html', route: 'chinh-sach-bao-mat', slug: 'chinh-sach-bao-mat', component: 'ChinhSachPage' },
  { file: 'Checkout 1.html', route: 'checkout/1', slug: 'checkout-1', component: 'Checkout1Page' },
  { file: 'Checkout 2.html', route: 'checkout/2', slug: 'checkout-2', component: 'Checkout2Page' },
  { file: 'Cap nhat nen tang.html', route: 'cap-nhat-nen-tang', slug: 'cap-nhat-nen-tang', component: 'CapNhatPage' },
  { file: 'Tai nguyen.html', route: 'admin/tai-nguyen', slug: 'tai-nguyen', component: 'TaiNguyenPage' },
  { file: 'Dashboard cua KH.html', route: 'dashboard', slug: 'dashboard', component: 'DashboardPage' },
  { file: 'Dashboard cua KH Cai dat.html', route: 'dashboard/cai-dat', slug: 'dashboard-cai-dat', component: 'DashboardCaiDatPage' },
  { file: 'Dashboard KH Lich su su dung.html', route: 'dashboard/lich-su', slug: 'dashboard-lich-su', component: 'DashboardLichSuPage' },
  { file: 'Admin Panel.html', route: 'admin', slug: 'admin-panel', component: 'AdminPanelPage' },
  { file: 'Quan tri KH.html', route: 'admin/khach-hang', slug: 'quan-tri-kh', component: 'QuanTriKHPage' },
  { file: 'Ha tang GPU.html', route: 'admin/ha-tang', slug: 'ha-tang-gpu', component: 'HaTangGPUPage' },
];

function extractParts(html) {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : 'GPUVietnam';

  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const css = styleMatch ? styleMatch[1].trim() : '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1].trim() : '';

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  const script = scriptMatch ? scriptMatch[1].trim() : '';

  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');

  return { title, css, body, script };
}

function htmlToJsx(html) {
  let jsx = html;

  jsx = jsx.replace(/<!--[\s\S]*?-->/g, '');
  jsx = jsx.replace(/\sclass=/g, ' className=');
  jsx = jsx.replace(/\sfor=/g, ' htmlFor=');
  jsx = jsx.replace(/\stabindex=/g, ' tabIndex=');
  jsx = jsx.replace(/\sreadonly/g, ' readOnly');
  jsx = jsx.replace(/\sautocomplete=/g, ' autoComplete=');
  jsx = jsx.replace(/\smaxlength=/g, ' maxLength=');
  jsx = jsx.replace(/\sminlength=/g, ' minLength=');
  jsx = jsx.replace(/\scrossorigin/g, ' crossOrigin');
  jsx = jsx.replace(/\scharset=/g, ' charSet=');

  jsx = jsx.replace(/<br\s*>/gi, '<br />');
  jsx = jsx.replace(/<hr\s*>/gi, '<hr />');
  jsx = jsx.replace(/<img([^>]*[^/])>/gi, '<img$1 />');
  jsx = jsx.replace(/<input([^>]*[^/])>/gi, '<input$1 />');
  jsx = jsx.replace(/<meta([^>]*[^/])>/gi, '<meta$1 />');
  jsx = jsx.replace(/<link([^>]*[^/])>/gi, '<link$1 />');

  jsx = jsx.replace(/\sonclick="([^"]*)"/g, (_, handler) => {
    const escaped = handler.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return ` onClick={() => { if (typeof window !== 'undefined') (0, eval)("${escaped}"); }}`;
  });

  jsx = jsx.replace(/\sonchange="([^"]*)"/g, (_, handler) => {
    const escaped = handler.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return ` onChange={() => { if (typeof window !== 'undefined') (0, eval)("${escaped}"); }}`;
  });

  jsx = jsx.replace(/\soninput="([^"]*)"/g, (_, handler) => {
    const escaped = handler.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return ` onInput={() => { if (typeof window !== 'undefined') (0, eval)("${escaped}"); }}`;
  });

  jsx = jsx.replace(/\sonsubmit="([^"]*)"/g, (_, handler) => {
    return ` onSubmit={(e) => { e.preventDefault(); ${handler} }}`;
  });

  jsx = jsx.replace(/giá vốn tăng >10%/g, 'giá vốn tăng &gt;10%');

  jsx = jsx.replace(/\sstyle="([^"]*)"/g, (_, styleStr) => {
    const parts = styleStr.split(';').filter(Boolean);
    const obj = parts.map(p => {
      const [key, ...vals] = p.split(':');
      const camelKey = key.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return `${camelKey}: '${vals.join(':').trim().replace(/'/g, "\\'")}'`;
    }).join(', ');
    return ` style={{ ${obj} }}`;
  });

  jsx = jsx.replace(/\sselected/g, ' defaultValue');

  return jsx.trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

for (const page of PAGE_MAP) {
  const htmlPath = path.join(HTML_DIR, page.file);
  if (!fs.existsSync(htmlPath)) {
    console.warn(`Skip missing: ${page.file}`);
    continue;
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const { title, css, body, script } = extractParts(html);
  const jsx = htmlToJsx(body);

  const cssPath = path.join(ROOT, 'src/styles/pages', `${page.slug}.styles.ts`);
  const escapedCss = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  writeFile(
    cssPath,
    `export const styles = \`${escapedCss}\`;\n`
  );

  if (script) {
    const escaped = script.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    writeFile(
      path.join(ROOT, 'src/lib/scripts', `${page.slug}.ts`),
      `export function init${page.component.replace('Page', '')}(): void {\n  if (typeof window === 'undefined') return;\n  const run = new Function(\`${escaped}\`);\n  run();\n}\n`
    );
  }

  const initFn = script ? `init${page.component.replace('Page', '')}` : null;
  const scriptImport = script
    ? `import { ${initFn} } from '@/lib/scripts/${page.slug}';\n`
    : '';
  const useEffectBlock = script
    ? `\n  useEffect(() => {\n    ${initFn}();\n  }, []);\n`
    : '';

  const reactImport = script ? `import { useEffect } from 'react';\n` : '';
  const stylesImport = `import { styles } from '@/styles/pages/${page.slug}.styles';\n`;
  const componentContent = `import Head from 'next/head';
${reactImport}${scriptImport}${stylesImport}

export default function ${page.component}() {
${useEffectBlock}  return (
    <>
      <Head>
        <title>${title.replace(/'/g, "\\'")}</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </Head>
      <>
${jsx.split('\n').map(line => '        ' + line).join('\n')}
      </>
    </>
  );
}
`;

  writeFile(
    path.join(ROOT, 'src/components/pages', `${page.component}.tsx`),
    componentContent
  );

  const routeParts = page.route.split('/');
  const pageDir = path.join(ROOT, 'src/pages', ...routeParts.slice(0, -1));
  const pageFile = routeParts[routeParts.length - 1] === 'index'
    ? path.join(ROOT, 'src/pages/index.tsx')
    : path.join(pageDir, `${routeParts[routeParts.length - 1]}.tsx`);

  const pageRouteContent = `import ${page.component} from '@/components/pages/${page.component}';\n\nexport default ${page.component};\n`;
  writeFile(pageFile, pageRouteContent);

  console.log(`Converted: ${page.file} -> ${page.route}`);
}

console.log('Done!');
