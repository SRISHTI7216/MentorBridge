import React, { useState } from 'react';
import { MOCK_CERTIFICATES } from '../../services/mockData';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const StudentCertificates: React.FC = () => {
  const [selectedCert, setSelectedCert] = useState<typeof MOCK_CERTIFICATES[0] | null>(null);

  return (
    <div className="p-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            Institutional Certificate Gallery & Verification
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Departmental credentials verified via ABET outcome rubrics and cryptographic nonces.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {MOCK_CERTIFICATES.map((cert) => (
          <Card key={cert.id} hoverEffect className="p-6 flex flex-col justify-between space-y-4 border-t-4 border-t-primary">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-500 font-semibold">{cert.certificateNo}</span>
                <Badge variant={cert.grade === 'Distinction' ? 'primary' : 'success'}>
                  {cert.grade}
                </Badge>
              </div>

              <div className="w-10 h-10 rounded-lg bg-indigo-50 text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">verified</span>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 text-sm leading-snug">{cert.title}</h3>
                <p className="text-[11px] text-slate-500 mt-1">Issued to: {cert.issuedTo} ({cert.rollNo})</p>
                <p className="text-[11px] text-slate-400">Date: {cert.issueDate}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono truncate">
                <span>Hash:</span>
                <span className="text-primary truncate max-w-[160px]">{cert.verifiableHash}</span>
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="flex-1 text-xs py-1" onClick={() => setSelectedCert(cert)}>
                  Verify Authenticity
                </Button>
                <Button size="sm" variant="primary" className="text-xs px-2.5 py-1" onClick={() => alert('Certificate PDF generated (Phase 1 mock).')}>
                  <span className="material-symbols-outlined text-sm">download</span>
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Verification Modal Dialog */}
      {selectedCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-outline-variant max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-xl">verified_user</span>
                <h3 className="font-bold text-sm text-slate-900">Cryptographic Verification Gate</h3>
              </div>
              <button onClick={() => setSelectedCert(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500">Certificate ID:</span>
                <span className="font-mono font-semibold text-slate-800">{selectedCert.certificateNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Recipient:</span>
                <span className="font-semibold text-slate-800">{selectedCert.issuedTo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Accredited By:</span>
                <span className="font-medium text-slate-800">{selectedCert.accreditedBy}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Integrity Hash:</span>
                <span className="font-mono text-primary font-bold truncate max-w-[180px]">{selectedCert.verifiableHash}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              This digital credential was issued under institutional FERPA compliance and signed by the Department of Computer Science & Engineering.
            </p>

            <div className="flex justify-end pt-2">
              <Button size="sm" variant="primary" onClick={() => setSelectedCert(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

