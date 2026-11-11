'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '@/lib/store';
import {
  Prospect,
  ProspectStatus,
  SocialPlatform,
  ProspectDuplicateCheckResult,
} from '@/types';
import {
  SOCIAL_PLATFORMS,
  PROSPECT_STATUSES,
  normalizeEmail,
  normalizeSocialHandle,
  detectSocialPlatformFromInput,
  buildSocialProfileUrl,
  sanitizeCsvCell,
  parseBulkProspectInput,
} from '@/lib/prospect-normalization';
import {
  getProspectsAction,
  addProspectAction,
  updateProspectAction,
  deleteProspectAction,
  bulkUpdateProspectsAction,
  checkProspectDuplicatesAction,
  previewBulkProspectsAction,
  importBulkProspectsAction,
  mergeProspectsAction,
  claimNextProspectAction,
  BulkPreviewRowResult,
} from '@/lib/actions/prospects';
import {
  Search,
  Plus,
  Upload,
  Download,
  Send,
  Edit3,
  Trash2,
  ExternalLink,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  X,
  Globe,
  GitMerge,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Filter,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';

interface ProspectsViewProps {
  onEmailProspect: (prospect: Prospect) => void;
}

export function PlatformBadge({
  platform,
  handle,
  handleNormalized,
  profileUrl,
}: {
  platform: SocialPlatform;
  handle: string;
  handleNormalized: string;
  profileUrl: string;
}) {
  const colors: Record<SocialPlatform, string> = {
    instagram: 'bg-pink-500/15 text-pink-300 border-pink-500/30 hover:bg-pink-500/25',
    linkedin: 'bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25',
    x: 'bg-white/10 text-white/85 border-white/20 hover:bg-white/20',
    tiktok: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25',
    facebook: 'bg-blue-500/15 text-blue-300 border-blue-500/30 hover:bg-blue-500/25',
    youtube: 'bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/25',
    website: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25',
    other: 'bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25',
  };

  const shortLabels: Record<SocialPlatform, string> = {
    instagram: 'IG',
    linkedin: 'IN',
    x: 'X',
    tiktok: 'TT',
    facebook: 'FB',
    youtube: 'YT',
    website: 'WEB',
    other: 'LINK',
  };

  const safeHref = /^https?:\/\//i.test(profileUrl)
    ? profileUrl
    : buildSocialProfileUrl(platform, handleNormalized, handle);

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={`${platform.toUpperCase()}: @${handleNormalized} (opens in new tab)`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border transition-colors ${colors[platform] || colors.other}`}
    >
      <span className="font-bold tracking-tight">{shortLabels[platform]}</span>
      <span className="truncate max-w-[95px] font-mono">
        {platform === 'website' ? handleNormalized : `@${handleNormalized}`}
      </span>
      <ExternalLink className="w-2.5 h-2.5 opacity-70 shrink-0" />
    </a>
  );
}

export function ProspectsView({ onEmailProspect }: ProspectsViewProps) {
  const {
    users,
    currentUser,
    teammatePresences,
    setActiveProspectId,
    setActiveProspectKey,
  } = useApp();

  const isAdmin =
    currentUser.role.includes('admin') ||
    currentUser.systemRole === 'admin' ||
    currentUser.name === 'Basim';

  // List & filter state
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assignedFilter, setAssignedFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [noEmailYet, setNoEmailYet] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<
    'created_at_desc' | 'created_at_asc' | 'name_asc' | 'company_asc' | 'status_asc'
  >('created_at_desc');

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignee, setBulkAssignee] = useState<string>('');
  const [bulkStatus, setBulkStatus] = useState<string>('');

  // Feedback banner
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Add / Edit Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);
  const [keepOpenOnSave, setKeepOpenOnSave] = useState(true);

  const [formFullName, setFormFullName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formSource, setFormSource] = useState('Instagram');
  const [formNotes, setFormNotes] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState<string>('');
  const [formStatus, setFormStatus] = useState<ProspectStatus>('new');
  const [formSocials, setFormSocials] = useState<
    { platform: SocialPlatform; handle: string }[]
  >([{ platform: 'instagram', handle: '' }]);

  const [liveDupCheck, setLiveDupCheck] = useState<ProspectDuplicateCheckResult | null>(
    null
  );
  const [isCheckingDup, setIsCheckingDup] = useState(false);
  const [confirmFuzzy, setConfirmFuzzy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingForm, setIsSavingForm] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Bulk Import / CSV Modal state
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkRawText, setBulkRawText] = useState('');
  const [bulkAssignTo, setBulkAssignTo] = useState<string>('');
  const [bulkPreview, setBulkPreview] = useState<{
    results: BulkPreviewRowResult[];
    newCount: number;
    duplicateCount: number;
    invalidCount: number;
  } | null>(null);
  const [isPreviewingBulk, setIsPreviewingBulk] = useState(false);
  const [isImportingBulk, setIsImportingBulk] = useState(false);

  // Merge Modal state
  const [mergeSourceProspect, setMergeSourceProspect] = useState<Prospect | null>(
    null
  );
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [isMerging, setIsMerging] = useState(false);

  // Claim Next Up loading state
  const [isClaimingNext, setIsClaimingNext] = useState(false);

  const loadProspects = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getProspectsAction({
        search,
        status: statusFilter,
        assignedTo: assignedFilter,
        platform: platformFilter,
        noEmailYet,
        sortBy,
        page,
        pageSize,
      });
      setProspects(res.prospects);
      setTotalCount(res.totalCount);
    } catch (err: any) {
      console.warn('Error loading prospects:', err);
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, assignedFilter, platformFilter, noEmailYet, sortBy, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadProspects();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadProspects]);

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [search, statusFilter, assignedFilter, platformFilter, noEmailYet, sortBy]);

  // Broadcast live prospect key while adding/editing so teammates see "X is working on this"
  useEffect(() => {
    if (!isAddModalOpen) {
      setActiveProspectId(null);
      setActiveProspectKey(null);
      return;
    }

    if (editingProspect) {
      setActiveProspectId(editingProspect.id);
    }

    const normEmail = normalizeEmail(formEmail);
    const firstSocial = formSocials[0]
      ? normalizeSocialHandle(formSocials[0].platform, formSocials[0].handle)
      : '';
    const key = normEmail || (firstSocial ? `${formSocials[0].platform}:${firstSocial}` : null);
    setActiveProspectKey(key);
  }, [isAddModalOpen, editingProspect, formEmail, formSocials, setActiveProspectId, setActiveProspectKey]);

  // Debounced live duplicate check while typing in Add/Edit modal
  useEffect(() => {
    if (!isAddModalOpen) return;

    const cleanEmail = formEmail.trim();
    const validSocials = formSocials.filter(s => s.handle.trim().length > 0);
    const hasNameAndCompany =
      formFullName.trim().length >= 3 && formCompany.trim().length >= 2;

    if (!cleanEmail && validSocials.length === 0 && !hasNameAndCompany) {
      setLiveDupCheck(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingDup(true);
      try {
        const res = await checkProspectDuplicatesAction({
          fullName: formFullName,
          company: formCompany,
          email: cleanEmail || null,
          socials: validSocials,
          excludeProspectId: editingProspect?.id,
        });
        setLiveDupCheck(res);
      } catch {
        // ignore transient network check errors
      } finally {
        setIsCheckingDup(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [isAddModalOpen, formFullName, formCompany, formEmail, formSocials, editingProspect]);

  const openAddModal = () => {
    setEditingProspect(null);
    setFormFullName('');
    setFormCompany('');
    setFormEmail('');
    setFormPhone('');
    setFormSource('Instagram');
    setFormNotes('');
    setFormAssignedTo(currentUser.id || '');
    setFormStatus('new');
    setFormSocials([{ platform: 'instagram', handle: '' }]);
    setLiveDupCheck(null);
    setConfirmFuzzy(false);
    setFormError(null);
    setIsAddModalOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 60);
  };

  const openEditModal = (p: Prospect) => {
    setEditingProspect(p);
    setFormFullName(p.fullName);
    setFormCompany(p.company || '');
    setFormEmail(p.email || '');
    setFormPhone(p.phone || '');
    setFormSource(p.source || '');
    setFormNotes(p.notes || '');
    setFormAssignedTo(p.assignedTo || '');
    setFormStatus(p.status);
    setFormSocials(
      p.socials.length > 0
        ? p.socials.map(s => ({ platform: s.platform, handle: s.handle }))
        : [{ platform: 'instagram', handle: '' }]
    );
    setLiveDupCheck(null);
    setConfirmFuzzy(false);
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleSaveProspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingForm) return;
    setFormError(null);

    const activeSocials = formSocials.filter(s => s.handle.trim().length > 0);
    if (!formEmail.trim() && activeSocials.length === 0) {
      setFormError('Please enter at least an email address or one social profile handle/URL.');
      return;
    }

    setIsSavingForm(true);
    try {
      const payload = {
        fullName: formFullName.trim(),
        company: formCompany.trim(),
        email: formEmail.trim() || null,
        phone: formPhone.trim() || null,
        notes: formNotes.trim(),
        source: formSource.trim(),
        status: formStatus,
        assignedTo: formAssignedTo || null,
        socials: activeSocials,
        confirmFuzzyDuplicate: confirmFuzzy,
      };

      const res = editingProspect
        ? await updateProspectAction(editingProspect.id, payload)
        : await addProspectAction(payload);

      if (!res.success) {
        if (res.duplicateCheck) {
          setLiveDupCheck(res.duplicateCheck);
        }
        setFormError(res.error || 'Could not save prospect.');
        setIsSavingForm(false);
        return;
      }

      await loadProspects();

      if (!editingProspect && keepOpenOnSave) {
        // Quick-add mode: reset fields and focus Name for the next prospect
        setFormFullName('');
        setFormCompany('');
        setFormEmail('');
        setFormPhone('');
        setFormNotes('');
        setFormSocials([{ platform: formSocials[0]?.platform || 'instagram', handle: '' }]);
        setLiveDupCheck(null);
        setConfirmFuzzy(false);
        setFormError(null);
        setFeedback({
          type: 'success',
          message: `Added "${res.prospect?.fullName}" — ready for next entry!`,
        });
        setTimeout(() => nameInputRef.current?.focus(), 40);
      } else {
        setIsAddModalOpen(false);
        setFeedback({
          type: 'success',
          message: editingProspect
            ? `Updated "${res.prospect?.fullName}".`
            : `Added "${res.prospect?.fullName}" to Prospects.`,
        });
      }
    } catch (err: any) {
      setFormError(err?.message || 'Unexpected error saving prospect.');
    } finally {
      setIsSavingForm(false);
    }
  };

  const handleDeleteProspect = async (p: Prospect) => {
    if (!window.confirm(`Delete prospect "${p.fullName}"? This cannot be undone.`)) {
      return;
    }
    const res = await deleteProspectAction(p.id);
    if (res.success) {
      setFeedback({ type: 'success', message: `Deleted "${p.fullName}".` });
      loadProspects();
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to delete prospect.' });
    }
  };

  const handleInlineAssign = async (prospectId: string, newAssigneeId: string) => {
    const res = await bulkUpdateProspectsAction({
      prospectIds: [prospectId],
      assignedTo: newAssigneeId || null,
    });
    if (res.success) {
      loadProspects();
    }
  };

  const handleInlineStatusChange = async (prospectId: string, newStatus: ProspectStatus) => {
    const res = await bulkUpdateProspectsAction({
      prospectIds: [prospectId],
      status: newStatus,
    });
    if (res.success) {
      loadProspects();
    }
  };

  const handleBulkApply = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const res = await bulkUpdateProspectsAction({
      prospectIds: ids,
      assignedTo: bulkAssignee ? (bulkAssignee === 'unassigned' ? null : bulkAssignee) : undefined,
      status: (bulkStatus as ProspectStatus) || undefined,
    });

    if (res.success) {
      setFeedback({
        type: 'success',
        message: `Updated ${res.updatedCount} selected prospect(s).`,
      });
      setSelectedIds(new Set());
      setBulkAssignee('');
      setBulkStatus('');
      loadProspects();
    } else {
      setFeedback({ type: 'error', message: res.error || 'Bulk update failed.' });
    }
  };

  // CSV Export (protects against CSV formula injection via sanitizeCsvCell)
  const handleExportCsv = () => {
    const rowsToExport =
      selectedIds.size > 0
        ? prospects.filter(p => selectedIds.has(p.id))
        : prospects;

    const headers = [
      'Full Name',
      'Company',
      'Email',
      'Normalized Email',
      'Status',
      'Social Profiles',
      'Source',
      'Assigned To',
      'Added By',
      'Created At',
      'Notes',
    ];

    const csvLines = [
      headers.map(sanitizeCsvCell).join(','),
      ...rowsToExport.map(p =>
        [
          p.fullName,
          p.company,
          p.email || '',
          p.emailNormalized || '',
          p.status,
          p.socials.map(s => `${s.platform}:@${s.handleNormalized}`).join(' ; '),
          p.source,
          p.assignedToName || 'Unassigned',
          p.addedByName || '',
          p.createdAt,
          p.notes,
        ]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `basim-crm-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download CSV Template for Bulk Import
  const handleDownloadCsvTemplate = () => {
    const template = [
      'Full Name,Company,Email,Social Handle or URL,Notes',
      'Sarah Jenkins,Lumen Studio,sarah@lumenstudio.io,https://instagram.com/lumenstudio,Creative director',
      'Omar Tariq,Vertex Labs,omar@vertexlabs.co,@omartariq_x,Saw product launch on X',
    ].join('\n');

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prospects-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download Duplicates Report CSV from Bulk Preview
  const handleDownloadDuplicatesReport = () => {
    if (!bulkPreview) return;
    const dupRows = bulkPreview.results.filter(r => r.ImportStatus !== 'new');
    const lines = [
      ['Row #', 'Status', 'Full Name', 'Company', 'Email', 'Socials', 'Reason']
        .map(sanitizeCsvCell)
        .join(','),
      ...dupRows.map(r =>
        [
          r.rowNumber,
          r.ImportStatus.toUpperCase(),
          r.fullName,
          r.company,
          r.email || '',
          r.socials.map(s => `${s.platform}:@${s.handleNormalized}`).join(' ; '),
          r.duplicateReason || r.invalidReason || 'Duplicate',
        ]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `duplicates-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunBulkPreview = async (textOverride?: string) => {
    const raw = textOverride !== undefined ? textOverride : bulkRawText;
    if (!raw.trim()) {
      setBulkPreview(null);
      return;
    }
    setIsPreviewingBulk(true);
    try {
      const parsedRows = parseBulkProspectInput(raw);
      const preview = await previewBulkProspectsAction(parsedRows);
      setBulkPreview(preview);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to preview rows.' });
    } finally {
      setIsPreviewingBulk(false);
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const content = String(ev.target?.result || '');
      setBulkRawText(content);
      handleRunBulkPreview(content);
    };
    reader.readAsText(file);
  };

  const handleConfirmBulkImport = async () => {
    if (!bulkPreview || bulkPreview.newCount === 0 || isImportingBulk) return;
    setIsImportingBulk(true);
    try {
      const parsedRows = parseBulkProspectInput(bulkRawText);
      const res = await importBulkProspectsAction({
        rows: parsedRows,
        assignToUserId: bulkAssignTo || null,
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Imported ${res.importedCount} new prospect(s) (${res.skippedDuplicates} duplicate(s) blocked).`,
        });
        setIsBulkModalOpen(false);
        setBulkRawText('');
        setBulkPreview(null);
        loadProspects();
      } else {
        setFeedback({ type: 'error', message: res.error || 'Import failed.' });
      }
    } finally {
      setIsImportingBulk(false);
    }
  };

  const handleConfirmMerge = async () => {
    if (!mergeSourceProspect || !mergeTargetId || isMerging) return;
    setIsMerging(true);
    try {
      const res = await mergeProspectsAction(mergeTargetId, mergeSourceProspect.id);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Merged "${mergeSourceProspect.fullName}" into "${res.mergedProspect?.fullName}". Combined all socials & notes.`,
        });
        setMergeSourceProspect(null);
        setMergeTargetId('');
        setIsAddModalOpen(false);
        loadProspects();
      } else {
        setFeedback({ type: 'error', message: res.error || 'Merge failed.' });
      }
    } finally {
      setIsMerging(false);
    }
  };

  const handleClaimNextUp = async () => {
    if (isClaimingNext) return;
    setIsClaimingNext(true);
    try {
      const res = await claimNextProspectAction();
      if (res.success && res.prospect) {
        setFeedback({
          type: 'success',
          message: `Claimed next prospect: ${res.prospect.fullName} (${res.prospect.email})`,
        });
        await loadProspects();
        onEmailProspect(res.prospect);
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'No prospects with email ready in the queue.',
        });
      }
    } finally {
      setIsClaimingNext(false);
    }
  };

  // Teammates currently working on the same prospect in the Add/Edit modal
  const modalActiveTeammates = useMemo(() => {
    if (!isAddModalOpen) return [];
    const normEmail = normalizeEmail(formEmail);
    const firstSoc = formSocials[0]
      ? normalizeSocialHandle(formSocials[0].platform, formSocials[0].handle)
      : '';
    const key = normEmail || (firstSoc ? `${formSocials[0].platform}:${firstSoc}` : null);

    return teammatePresences.filter(
      t =>
        t.id !== currentUser.id &&
        t.status !== 'offline' &&
        ((editingProspect && t.currentProspectId === editingProspect.id) ||
          (key && t.currentProspectKey === key))
    );
  }, [isAddModalOpen, formEmail, formSocials, editingProspect, teammatePresences, currentUser.id]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 sm:p-6 space-y-4 animate-in fade-in duration-200">
      {/* Top Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-lg font-bold text-white/95 tracking-tight">
              Prospects Directory
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#0A84FF]/15 text-[#0A84FF] border border-[#0A84FF]/30 font-mono">
              {totalCount} total
            </span>
          </div>
          <p className="text-xs text-white/50 mt-0.5">
            Shared lead list with automatic Gmail & social handle normalization and strict duplicate protection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Next Up Button */}
          <button
            onClick={handleClaimNextUp}
            disabled={isClaimingNext}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#30D158]/15 hover:bg-[#30D158]/25 text-[#30D158] border border-[#30D158]/30 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
            title="Grab your next assigned or unassigned prospect with an email and open the outreach composer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isClaimingNext ? 'Claiming...' : 'Next Up to Email'}</span>
          </button>

          {/* Bulk Paste / CSV Import */}
          <button
            onClick={() => {
              setIsBulkModalOpen(true);
              setBulkPreview(null);
            }}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white/85 border border-white/10 text-xs font-semibold transition-all cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#0A84FF]" />
            <span>Bulk Import / CSV</span>
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCsv}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/75 border border-white/10 text-xs font-medium transition-all cursor-pointer"
            title="Export prospects to CSV (formula-injection safe)"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          {/* Add Prospect Primary Button */}
          <button
            onClick={openAddModal}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl apple-primary-btn text-xs font-semibold shadow-sm active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" strokeWidth={2.2} />
            <span>Add Prospect</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-2.5 px-4 rounded-xl text-xs flex items-center justify-between border animate-in fade-in ${
            feedback.type === 'success'
              ? 'bg-[#30D158]/15 border-[#30D158]/30 text-[#30D158]'
              : 'bg-[#FF453A]/15 border-[#FF453A]/30 text-[#FF453A]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-white/50 hover:text-white ml-4"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search, Filters & Sort Bar */}
      <div className="p-3 rounded-2xl bg-white/[0.03] dark:bg-black/25 border border-white/10 flex flex-wrap items-center gap-2.5">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, company, email, @handle, or notes..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] focus:bg-white/[0.1] border border-white/10 focus:border-[#0A84FF]/60 text-xs text-white placeholder-white/40 focus:outline-none"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white/85 focus:outline-none cursor-pointer"
        >
          <option value="all" className="bg-slate-900 text-white">Status: All</option>
          {PROSPECT_STATUSES.map(s => (
            <option key={s.value} value={s.value} className="bg-slate-900 text-white">
              Status: {s.label}
            </option>
          ))}
        </select>

        {/* Assigned To Filter */}
        <select
          value={assignedFilter}
          onChange={e => setAssignedFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white/85 focus:outline-none cursor-pointer"
        >
          <option value="all" className="bg-slate-900 text-white">Assigned: Everyone</option>
          <option value="unassigned" className="bg-slate-900 text-white">Unassigned Only</option>
          {users.map(u => (
            <option key={u.id} value={u.id} className="bg-slate-900 text-white">
              Assigned: {u.name}
            </option>
          ))}
        </select>

        {/* Social Platform Filter */}
        <select
          value={platformFilter}
          onChange={e => setPlatformFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white/85 focus:outline-none cursor-pointer"
        >
          <option value="all" className="bg-slate-900 text-white">Platform: All</option>
          {SOCIAL_PLATFORMS.map(p => (
            <option key={p.value} value={p.value} className="bg-slate-900 text-white">
              Platform: {p.label}
            </option>
          ))}
        </select>

        {/* "No Email Yet" Toggle */}
        <button
          onClick={() => setNoEmailYet(prev => !prev)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
            noEmailYet
              ? 'bg-[#FF9F0A]/20 text-[#FF9F0A] border-[#FF9F0A]/40'
              : 'bg-white/[0.05] text-white/70 border-white/10 hover:text-white'
          }`}
        >
          Needs Email Only
        </button>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
          className="px-2.5 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white/85 focus:outline-none cursor-pointer"
        >
          <option value="created_at_desc" className="bg-slate-900 text-white">Sort: Newest</option>
          <option value="created_at_asc" className="bg-slate-900 text-white">Sort: Oldest</option>
          <option value="name_asc" className="bg-slate-900 text-white">Sort: Name (A–Z)</option>
          <option value="company_asc" className="bg-slate-900 text-white">Sort: Company (A–Z)</option>
          <option value="status_asc" className="bg-slate-900 text-white">Sort: Status</option>
        </select>
      </div>

      {/* Bulk Actions Bar when rows are selected */}
      {selectedIds.size > 0 && (
        <div className="p-2.5 px-4 rounded-2xl bg-[#0A84FF]/15 border border-[#0A84FF]/35 flex flex-wrap items-center justify-between gap-3 text-xs animate-in fade-in">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-white">
              {selectedIds.size} prospect(s) selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-white/60 hover:text-white underline text-[11px]"
            >
              Clear
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkAssignee}
              onChange={e => setBulkAssignee(e.target.value)}
              className="px-2.5 py-1 rounded-lg bg-black/50 border border-white/15 text-xs text-white"
            >
              <option value="">Assign selected to...</option>
              <option value="unassigned">Unassigned</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              className="px-2.5 py-1 rounded-lg bg-black/50 border border-white/15 text-xs text-white"
            >
              <option value="">Change status to...</option>
              {PROSPECT_STATUSES.map(s => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <button
              onClick={handleBulkApply}
              disabled={!bulkAssignee && !bulkStatus}
              className="px-3 py-1 rounded-lg apple-primary-btn text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              Apply
            </button>

            <button
              onClick={handleExportCsv}
              className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium cursor-pointer"
            >
              Export Selected CSV
            </button>
          </div>
        </div>
      )}

      {/* Prospects Table */}
      <div className="flex-1 overflow-auto rounded-2xl border border-white/10 bg-white/[0.02] dark:bg-black/25 backdrop-blur-2xl">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-[#12131C]/95 backdrop-blur-xl border-b border-white/10 text-[10.5px] uppercase tracking-wider text-white/45 font-semibold">
            <tr>
              <th className="py-3 px-3 w-8">
                <input
                  type="checkbox"
                  checked={
                    prospects.length > 0 &&
                    prospects.every(p => selectedIds.has(p.id))
                  }
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(prospects.map(p => p.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  className="rounded border-white/20 bg-white/10 cursor-pointer"
                />
              </th>
              <th className="py-3 px-3">Prospect</th>
              <th className="py-3 px-3">Company</th>
              <th className="py-3 px-3">Email</th>
              <th className="py-3 px-3">Social Profiles</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Assigned To</th>
              <th className="py-3 px-3">Added By</th>
              <th className="py-3 px-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.06] text-xs">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <tr key={idx} className="animate-pulse">
                  <td colSpan={9} className="py-3.5 px-4">
                    <div className="h-5 rounded-lg bg-white/[0.05] w-full" />
                  </td>
                </tr>
              ))
            ) : prospects.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-white/45">
                  <p className="text-sm font-medium text-white/70">No prospects found</p>
                  <p className="text-xs text-white/40 mt-1">
                    Click &ldquo;Add Prospect&rdquo; or &ldquo;Bulk Import / CSV&rdquo; to build your team outreach list.
                  </p>
                </td>
              </tr>
            ) : (
              prospects.map(p => {
                const statusMeta =
                  PROSPECT_STATUSES.find(s => s.value === p.status) ||
                  PROSPECT_STATUSES[0];

                const canDelete = isAdmin || p.addedBy === currentUser.id;
                const canEmail =
                  Boolean(p.email) &&
                  p.status !== 'bad_email' &&
                  p.status !== 'do_not_contact';

                // Check if a teammate is currently working on this prospect live
                const workingTeammates = teammatePresences.filter(
                  t =>
                    t.id !== currentUser.id &&
                    t.status !== 'offline' &&
                    (t.currentProspectId === p.id ||
                      (p.emailNormalized && t.currentProspectKey === p.emailNormalized))
                );

                return (
                  <tr
                    key={p.id}
                    className="hover:bg-white/[0.04] transition-colors group"
                  >
                    <td className="py-3 px-3 align-middle">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={e => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          setSelectedIds(next);
                        }}
                        className="rounded border-white/20 bg-white/10 cursor-pointer"
                      />
                    </td>

                    {/* Name & Notes / Needs Email tag */}
                    <td className="py-3 px-3 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white/95">
                          {p.fullName}
                        </span>
                        {!p.email && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30">
                            Needs email
                          </span>
                        )}
                      </div>

                      {p.notes && (
                        <p className="text-[11px] text-white/45 truncate max-w-[210px] mt-0.5">
                          {p.notes}
                        </p>
                      )}

                      {workingTeammates.length > 0 && (
                        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FF9F0A]/15 border border-[#FF9F0A]/30 text-[10px] text-[#FF9F0A] font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#FF9F0A] animate-ping" />
                          <span>
                            {workingTeammates.map(t => t.name).join(' & ')} is working on this
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Company & Source */}
                    <td className="py-3 px-3 align-middle">
                      <div className="text-white/85 font-medium">
                        {p.company || '—'}
                      </div>
                      {p.source && (
                        <div className="text-[10.5px] text-white/40">
                          via {p.source}
                        </div>
                      )}
                    </td>

                    {/* Email */}
                    <td className="py-3 px-3 align-middle font-mono text-[11.5px]">
                      {p.email ? (
                        <span className="text-white/85">{p.email}</span>
                      ) : (
                        <span className="text-white/30 italic">No email yet</span>
                      )}
                    </td>

                    {/* Clickable Social Icons */}
                    <td className="py-3 px-3 align-middle">
                      <div className="flex flex-wrap items-center gap-1">
                        {p.socials.length === 0 ? (
                          <span className="text-white/30 text-[11px]">—</span>
                        ) : (
                          p.socials.map(soc => (
                            <PlatformBadge
                              key={soc.id}
                              platform={soc.platform}
                              handle={soc.handle}
                              handleNormalized={soc.handleNormalized}
                              profileUrl={soc.profileUrl}
                            />
                          ))
                        )}
                      </div>
                    </td>

                    {/* Status Pill / Quick Selector */}
                    <td className="py-3 px-3 align-middle">
                      <select
                        value={p.status}
                        onChange={e =>
                          handleInlineStatusChange(p.id, e.target.value as ProspectStatus)
                        }
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border focus:outline-none cursor-pointer ${statusMeta.badgeClass}`}
                      >
                        {PROSPECT_STATUSES.map(st => (
                          <option
                            key={st.value}
                            value={st.value}
                            className="bg-slate-900 text-white"
                          >
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Assigned To */}
                    <td className="py-3 px-3 align-middle">
                      <select
                        value={p.assignedTo || ''}
                        onChange={e => handleInlineAssign(p.id, e.target.value)}
                        className="px-2 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[11.5px] text-white/85 focus:outline-none cursor-pointer"
                      >
                        <option value="" className="bg-slate-900 text-white">
                          Unassigned
                        </option>
                        {users.map(u => (
                          <option
                            key={u.id}
                            value={u.id}
                            className="bg-slate-900 text-white"
                          >
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Added By & Date */}
                    <td className="py-3 px-3 align-middle text-[11px] text-white/55">
                      <div className="font-medium text-white/80">
                        {p.addedByName}
                      </div>
                      <div className="text-[10px] text-white/40">
                        {new Date(p.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                    </td>

                    {/* Row Actions */}
                    <td className="py-3 px-3 align-middle text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          onClick={() => onEmailProspect(p)}
                          disabled={!canEmail}
                          title={
                            !p.email
                              ? 'Add an email address first before sending outreach'
                              : !canEmail
                              ? `Cannot email prospect with status: ${p.status}`
                              : `Email ${p.fullName} from your personal mailbox`
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#0A84FF]/15 hover:bg-[#0A84FF]/30 text-[#0A84FF] border border-[#0A84FF]/30 text-[11px] font-semibold transition-colors disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
                        >
                          <Send className="w-3 h-3" />
                          <span>Email</span>
                        </button>

                        <button
                          onClick={() => openEditModal(p)}
                          title="Edit prospect"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => {
                            setMergeSourceProspect(p);
                            setMergeTargetId('');
                          }}
                          title="Merge duplicate prospect"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                        </button>

                        {canDelete && (
                          <button
                            onClick={() => handleDeleteProspect(p)}
                            title="Delete prospect"
                            className="p-1.5 rounded-lg hover:bg-[#FF453A]/20 text-white/50 hover:text-[#FF453A] transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer (50 per page) */}
      <div className="flex items-center justify-between text-xs text-white/55 px-1">
        <div>
          Showing{' '}
          <strong className="text-white/85">
            {totalCount === 0 ? 0 : page * pageSize + 1}
          </strong>{' '}
          –{' '}
          <strong className="text-white/85">
            {Math.min(totalCount, (page + 1) * pageSize)}
          </strong>{' '}
          of <strong className="text-white/85">{totalCount}</strong> prospects (50 per page)
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 px-3 py-1 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/80 disabled:opacity-35 cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev</span>
          </button>
          <span className="font-mono text-[11px]">
            Page {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages}
            className="flex items-center gap-1 px-3 py-1 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/80 disabled:opacity-35 cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* =====================================================================
          ADD / EDIT PROSPECT MODAL (with live duplicate check & Quick-Add)
      ===================================================================== */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setIsAddModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-3xl bg-[#11131C]/95 border border-white/15 backdrop-blur-3xl shadow-2xl p-6 text-white max-h-[92vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h2 className="text-base font-bold text-white/95">
                  {editingProspect ? 'Edit Prospect' : 'Add New Prospect'}
                </h2>
                <p className="text-[11px] text-white/50">
                  Emails and social handles are normalized and checked live for duplicates.
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Teammate Presence Notice */}
            {modalActiveTeammates.length > 0 && (
              <div className="p-2.5 px-3 rounded-xl bg-[#FF9F0A]/15 border border-[#FF9F0A]/35 flex items-center gap-2 text-xs text-[#FF9F0A]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  ⚡{' '}
                  <strong>
                    {modalActiveTeammates.map(t => t.name).join(' & ')}
                  </strong>{' '}
                  is currently working on this same prospect!
                </span>
              </div>
            )}

            {/* Live Exact Duplicate Block Alert */}
            {liveDupCheck?.hasExactDuplicate && (
              <div className="p-3 rounded-xl bg-[#FF453A]/15 border border-[#FF453A]/40 space-y-1.5 text-xs text-[#FF453A]">
                <div className="flex items-center gap-2 font-bold">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>Duplicate Blocked</span>
                </div>
                {liveDupCheck.blockingMatches.map((m, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 pl-6 text-[11.5px] text-red-200"
                  >
                    <span>• {m.message}</span>
                    {m.existingProspectId && (
                      <button
                        type="button"
                        onClick={() => {
                          const existing = prospects.find(
                            p => p.id === m.existingProspectId
                          );
                          if (existing) {
                            openEditModal(existing);
                          }
                        }}
                        className="underline font-semibold text-white hover:text-[#0A84FF] shrink-0"
                      >
                        View Existing →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Live Fuzzy Duplicate Warning */}
            {!liveDupCheck?.hasExactDuplicate &&
              liveDupCheck &&
              liveDupCheck.fuzzyWarnings.length > 0 && (
                <div className="p-3 rounded-xl bg-[#FF9F0A]/15 border border-[#FF9F0A]/35 space-y-2 text-xs text-[#FF9F0A]">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Possible Duplicate Found</span>
                  </div>
                  {liveDupCheck.fuzzyWarnings.map((fw, i) => (
                    <div key={i} className="pl-6 text-[11.5px] text-amber-200/90">
                      • <strong>{fw.fullName}</strong>{' '}
                      {fw.company ? `at ${fw.company}` : ''} — added by{' '}
                      {fw.addedByName} (status: {fw.status}) • {fw.reason}
                    </div>
                  ))}
                  <label className="flex items-center gap-2 pl-6 pt-1 text-white/90 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmFuzzy}
                      onChange={e => setConfirmFuzzy(e.target.checked)}
                      className="rounded border-white/20"
                    />
                    <span>I confirm this is a different person — save anyway</span>
                  </label>
                </div>
              )}

            {formError && (
              <div className="p-2.5 px-3 rounded-xl bg-[#FF453A]/15 border border-[#FF453A]/35 text-xs text-[#FF453A] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProspect} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Full Name *
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    required
                    value={formFullName}
                    onChange={e => setFormFullName(e.target.value)}
                    placeholder="e.g. Sarah Jenkins"
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Company
                  </label>
                  <input
                    type="text"
                    value={formCompany}
                    onChange={e => setFormCompany(e.target.value)}
                    placeholder="e.g. Lumen Studio"
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-white/60">
                      Email Address (optional if social added)
                    </label>
                    {formEmail.trim() && normalizeEmail(formEmail) && (
                      <span className="text-[10px] font-mono text-[#0A84FF]">
                        → {normalizeEmail(formEmail)}
                      </span>
                    )}
                  </div>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Assign To Teammate
                  </label>
                  <select
                    value={formAssignedTo}
                    onChange={e => setFormAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white focus:outline-none focus:border-[#0A84FF]"
                  >
                    <option value="" className="bg-slate-900 text-white">
                      Unassigned
                    </option>
                    {users.map(u => (
                      <option
                        key={u.id}
                        value={u.id}
                        className="bg-slate-900 text-white"
                      >
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dynamic Social Profile Rows */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-white/60">
                    Social Profiles (URL or @handle)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setFormSocials(prev => [
                        ...prev,
                        { platform: 'instagram', handle: '' },
                      ])
                    }
                    className="text-[11px] font-semibold text-[#0A84FF] hover:underline cursor-pointer"
                  >
                    + Add another social
                  </button>
                </div>

                {formSocials.map((soc, idx) => {
                  const normPreview = normalizeSocialHandle(soc.platform, soc.handle);
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <select
                          value={soc.platform}
                          onChange={e => {
                            const updated = [...formSocials];
                            updated[idx].platform = e.target.value as SocialPlatform;
                            setFormSocials(updated);
                          }}
                          className="w-32 px-2.5 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white focus:outline-none"
                        >
                          {SOCIAL_PLATFORMS.map(p => (
                            <option
                              key={p.value}
                              value={p.value}
                              className="bg-slate-900 text-white"
                            >
                              {p.label}
                            </option>
                          ))}
                        </select>

                        <input
                          type="text"
                          value={soc.handle}
                          onChange={e => {
                            const val = e.target.value;
                            const detected = detectSocialPlatformFromInput(
                              val,
                              soc.platform
                            );
                            const updated = [...formSocials];
                            updated[idx] = { platform: detected, handle: val };
                            setFormSocials(updated);
                          }}
                          placeholder={
                            SOCIAL_PLATFORMS.find(p => p.value === soc.platform)
                              ?.placeholder || '@handle or URL'
                          }
                          className="flex-1 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-[#0A84FF]"
                        />

                        {formSocials.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setFormSocials(prev => prev.filter((_, i) => i !== idx))
                            }
                            className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {soc.handle.trim() && normPreview && (
                        <div className="text-[10px] font-mono text-white/45 pl-1">
                          Normalized key: <strong className="text-[#30D158]">{soc.platform}:@{normPreview}</strong>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Source
                  </label>
                  <input
                    type="text"
                    value={formSource}
                    onChange={e => setFormSource(e.target.value)}
                    placeholder="e.g. Instagram, LinkedIn, Referral"
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Phone (optional)
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                    placeholder="+1 555 234 5678"
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1">
                  Research Notes (shown in Composer when emailing)
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="e.g. Loved their recent reel on e-commerce branding..."
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white focus:outline-none focus:border-[#0A84FF] resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                {!editingProspect ? (
                  <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={keepOpenOnSave}
                      onChange={e => setKeepOpenOnSave(e.target.checked)}
                      className="rounded border-white/20"
                    />
                    <span>Quick-add mode (Enter saves &amp; keeps modal open)</span>
                  </label>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-xs text-white/80 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSavingForm || Boolean(liveDupCheck?.hasExactDuplicate)
                    }
                    className="px-5 py-2 rounded-xl apple-primary-btn text-xs font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    {isSavingForm
                      ? 'Saving...'
                      : editingProspect
                      ? 'Save Changes'
                      : keepOpenOnSave
                      ? 'Save & Next ↵'
                      : 'Add Prospect'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          BULK PASTE / CSV IMPORT MODAL (up to 500 rows + Duplicates Report)
      ===================================================================== */}
      {isBulkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setIsBulkModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-3xl bg-[#11131C]/95 border border-white/15 backdrop-blur-3xl shadow-2xl p-6 text-white max-h-[92vh] flex flex-col space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h2 className="text-base font-bold text-white/95">
                  Bulk Add &amp; CSV Import (Max 500 Rows)
                </h2>
                <p className="text-[11px] text-white/50">
                  Paste one prospect per line (Name, Social URL/@handle, Email in any order) or upload a CSV.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadCsvTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-[11px] text-[#0A84FF] font-semibold cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>CSV Template</span>
                </button>
                <button
                  onClick={() => setIsBulkModalOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  Upload CSV File
                </label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleCsvFileUpload}
                  className="w-full text-xs text-white/70 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#0A84FF]/20 file:text-[#0A84FF] hover:file:bg-[#0A84FF]/30 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  Assign Imported Prospects To (optional)
                </label>
                <select
                  value={bulkAssignTo}
                  onChange={e => setBulkAssignTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white"
                >
                  <option value="" className="bg-slate-900 text-white">
                    Leave Unassigned
                  </option>
                  {users.map(u => (
                    <option key={u.id} value={u.id} className="bg-slate-900 text-white">
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <textarea
                rows={5}
                value={bulkRawText}
                onChange={e => setBulkRawText(e.target.value)}
                placeholder={`Paste lines here (any order per line):\nSarah Jenkins, https://instagram.com/lumenstudio, sarah@lumenstudio.io\n@omartariq_x, Omar Tariq, Vertex Labs, omar@vertexlabs.co`}
                className="w-full p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-[#0A84FF] resize-none"
              />
              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  onClick={() => handleRunBulkPreview()}
                  disabled={!bulkRawText.trim() || isPreviewingBulk}
                  className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
                >
                  {isPreviewingBulk ? 'Checking Duplicates...' : 'Preview & Check Duplicates'}
                </button>
              </div>
            </div>

            {/* Preview Table */}
            {bulkPreview && (
              <div className="flex-1 overflow-hidden flex flex-col space-y-2 border-t border-white/10 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30 font-semibold">
                      {bulkPreview.newCount} New Valid
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30 font-semibold">
                      {bulkPreview.duplicateCount} Duplicates Blocked
                    </span>
                    {bulkPreview.invalidCount > 0 && (
                      <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-white/70 font-semibold">
                        {bulkPreview.invalidCount} Invalid
                      </span>
                    )}
                  </div>

                  {(bulkPreview.duplicateCount > 0 ||
                    bulkPreview.invalidCount > 0) && (
                    <button
                      type="button"
                      onClick={handleDownloadDuplicatesReport}
                      className="flex items-center gap-1 text-[11px] font-semibold text-[#FF9F0A] hover:underline cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Duplicates Report (CSV)</span>
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto max-h-56 rounded-xl border border-white/10 bg-black/40">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="sticky top-0 bg-[#12131C] border-b border-white/10 text-white/45">
                      <tr>
                        <th className="py-2 px-2.5">#</th>
                        <th className="py-2 px-2.5">Status</th>
                        <th className="py-2 px-2.5">Name</th>
                        <th className="py-2 px-2.5">Email</th>
                        <th className="py-2 px-2.5">Socials</th>
                        <th className="py-2 px-2.5">Details / Duplicate Of</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {bulkPreview.results.map(r => (
                        <tr key={r.rowNumber}>
                          <td className="py-1.5 px-2.5 font-mono text-white/40">
                            {r.rowNumber}
                          </td>
                          <td className="py-1.5 px-2.5">
                            {r.ImportStatus === 'new' ? (
                              <span className="px-2 py-0.5 rounded-full bg-[#30D158]/20 text-[#30D158] font-bold text-[10px]">
                                NEW
                              </span>
                            ) : r.ImportStatus === 'duplicate' ? (
                              <span className="px-2 py-0.5 rounded-full bg-[#FF453A]/20 text-[#FF453A] font-bold text-[10px]">
                                DUPLICATE
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-white/15 text-white/60 font-bold text-[10px]">
                                INVALID
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2.5 font-medium text-white/90">
                            {r.fullName || '—'}
                          </td>
                          <td className="py-1.5 px-2.5 font-mono text-white/75">
                            {r.emailNormalized || '—'}
                          </td>
                          <td className="py-1.5 px-2.5 font-mono text-white/75">
                            {r.socials
                              .map(s => `${s.platform}:@${s.handleNormalized}`)
                              .join(', ') || '—'}
                          </td>
                          <td className="py-1.5 px-2.5 text-white/60">
                            {r.duplicateReason || 'Ready to import'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-xs text-white/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkImport}
                disabled={
                  !bulkPreview || bulkPreview.newCount === 0 || isImportingBulk
                }
                className="px-5 py-2 rounded-xl apple-primary-btn text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                {isImportingBulk
                  ? 'Importing...'
                  : `Import ${bulkPreview?.newCount || 0} New Prospect(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          DUPLICATE-SAFE MERGE MODAL
      ===================================================================== */}
      {mergeSourceProspect && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setMergeSourceProspect(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-[#11131C]/95 border border-white/15 backdrop-blur-3xl shadow-2xl p-6 text-white space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-[#0A84FF]" />
                <h2 className="text-sm font-bold text-white">
                  Merge Prospect
                </h2>
              </div>
              <button
                onClick={() => setMergeSourceProspect(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-white/65 leading-relaxed">
              Merge <strong>{mergeSourceProspect.fullName}</strong> into another prospect record. All social profiles and notes will be combined, and the earliest creation timestamp will be preserved.
            </p>

            <div>
              <label className="block text-[11px] text-white/60 mb-1">
                Select Target Prospect to Keep:
              </label>
              <select
                value={mergeTargetId}
                onChange={e => setMergeTargetId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white"
              >
                <option value="" className="bg-slate-900 text-white">
                  Choose prospect...
                </option>
                {prospects
                  .filter(p => p.id !== mergeSourceProspect.id)
                  .map(p => (
                    <option
                      key={p.id}
                      value={p.id}
                      className="bg-slate-900 text-white"
                    >
                      {p.fullName} ({p.email || p.company || 'No email'})
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setMergeSourceProspect(null)}
                className="px-4 py-1.5 rounded-xl bg-white/[0.06] text-xs text-white/75"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMerge}
                disabled={!mergeTargetId || isMerging}
                className="px-4 py-1.5 rounded-xl apple-primary-btn text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                {isMerging ? 'Merging...' : 'Merge Prospects'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
