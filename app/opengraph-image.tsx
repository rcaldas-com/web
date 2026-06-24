// @ts-nocheck
import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'RCaldas – Serviços Web, Blockchain e Segurança';

const appTitle = process.env.TITLE || 'RCaldas';
const appDescription = process.env.DESCRIPTION || 'Serviços Web, Blockchain e Segurança';

export default async function OgImage() {
  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'inter.ttf');
  const logoPath = path.join(process.cwd(), 'public', 'logo.png');
  const [fontData, logoData] = await Promise.all([readFile(fontPath), readFile(logoPath)]);
  const logoSrc = `data:image/png;base64,${logoData.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          background: 'linear-gradient(135deg, #09090b 0%, #18181b 55%, #0f2a1a 100%)',
          fontFamily: 'Inter, sans-serif',
          position: 'relative',
        }}
      >
        {/* Decorative blobs */}
        <div
          style={{
            position: 'absolute',
            top: '-140px',
            right: '-80px',
            width: '480px',
            height: '480px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.18) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-100px',
            left: '30%',
            width: '320px',
            height: '320px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(5,150,105,0.25) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '45%',
            left: '60%',
            width: '160px',
            height: '160px',
            borderRadius: '50%',
            background: 'rgba(16,185,129,0.06)',
          }}
        />

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            padding: '64px 80px',
            width: '1200px',
            gap: '64px',
          }}
        >
          {/* Logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            width={170}
            height={170}
            style={{ borderRadius: '16px', flexShrink: 0 }}
            alt="RC"
          />

          {/* Text */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                color: '#ffffff',
                fontSize: '80px',
                fontWeight: 900,
                lineHeight: 1.0,
                letterSpacing: '-3px',
                display: 'block',
              }}
            >
              Gerencie sua vida
            </span>
            <span
              style={{
                color: '#34d399',
                fontSize: '80px',
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: '-3px',
                display: 'block',
                marginBottom: '28px',
              }}
            >
              em um so lugar.
            </span>
            <span
              style={{
                color: '#a1a1aa',
                fontSize: '36px',
                fontWeight: 400,
                lineHeight: 1.3,
                display: 'block',
              }}
            >
              {appDescription}
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Inter', data: fontData, weight: 400, style: 'normal' },
        { name: 'Inter', data: fontData, weight: 700, style: 'normal' },
        { name: 'Inter', data: fontData, weight: 900, style: 'normal' },
      ],
    },
  );
}
