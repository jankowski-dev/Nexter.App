import { TabGroup } from '@/components/ui/list-toolbar';
import { PageHeader } from '@/components/ui/page-header';
import { useState } from 'react';
import { DataQualityPage } from './data-quality-page';
import { SystemStatusPage } from './system-status-page';

type DiagnosticsTab = 'system' | 'quality';

export function DiagnosticsSettingsPage() {
  const [tab, setTab] = useState<DiagnosticsTab>('system');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Диагностика"
        subtitle="Состояние источников, роботов, свапов и качество данных. Только чтение."
      />
      <TabGroup
        value={tab}
        onChange={setTab}
        ariaLabel="Раздел диагностики"
        options={[
          { value: 'system', label: 'Система' },
          { value: 'quality', label: 'Качество данных' },
        ]}
      />
      {tab === 'system' ? <SystemStatusPage /> : <DataQualityPage />}
    </div>
  );
}
