// client/src/pages/Login.tsx
import React from 'react';

export default function Login({ error }: { error?: string | null }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: '#f8fafc' }}
    >
      <div className="flex flex-col items-center gap-6 w-full max-w-sm">
        {/* Branding */}
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="CareSpace" className="h-10 w-10 object-contain" />
          <div>
            <p className="font-bold text-xl" style={{ color: '#0E0E0E' }}>CareSpace</p>
            <p className="text-xs" style={{ color: 'rgba(14,14,14,0.40)' }}>struktura</p>
          </div>
        </div>

        {/* Login card */}
        <div className="card w-full flex flex-col gap-5">
          <div className="text-center">
            <h1 className="font-semibold text-slate-800 text-lg">Sign in to continue</h1>
            <p className="text-sm text-slate-400 mt-1">Use your Struktura Google account</p>
          </div>

          {error === 'unauthorized' && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-center">
              Your account is not authorised. Contact your team lead.
            </div>
          )}

          <a
            href="/api/auth/google"
            className="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all"
            style={{ backgroundColor: '#0E0E0E', color: '#ffffff', textDecoration: 'none' }}
          >
            <GoogleIcon />
            Sign in with Google
          </a>
        </div>

        <p className="text-xs text-center" style={{ color: 'rgba(14,14,14,0.38)' }}>
          Access is restricted to authorised team members.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.215 17.64 11.907 17.64 9.2z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.55 0 9s.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
