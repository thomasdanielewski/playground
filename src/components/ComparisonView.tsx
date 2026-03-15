import { useState } from 'react';

type Tab = 'source' | 'depth' | 'mask' | 'normals' | '3d';

interface Props {
  sourceUrl: string | null;
  depthMapUrl: string | null;
  maskUrl: string | null;
  normalMapUrl?: string | null;
  onSelectTab: (tab: Tab) => void;
}

export default function ComparisonView({ sourceUrl, depthMapUrl, maskUrl, normalMapUrl, onSelectTab }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('3d');

  const tabs: { id: Tab; label: string; available: boolean }[] = [
    { id: '3d', label: '3D', available: true },
    { id: 'source', label: 'Source', available: !!sourceUrl },
    { id: 'depth', label: 'Depth', available: !!depthMapUrl },
    { id: 'mask', label: 'Mask', available: !!maskUrl },
    { id: 'normals', label: 'Normals', available: !!normalMapUrl },
  ];

  const handleTab = (tab: Tab) => {
    setActiveTab(tab);
    onSelectTab(tab);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Tab bar */}
      <div className="flex gap-0.5 p-0.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => tab.available && handleTab(tab.id)}
            disabled={!tab.available}
            className={`flex-1 py-0.5 rounded text-[10px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white/15 text-white'
                : tab.available
                  ? 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]'
                  : 'text-zinc-700 cursor-not-allowed'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Image overlay (source / depth / mask / normals) */}
      {activeTab !== '3d' && (
        <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black/50 border border-white/[0.06] animate-fade-in">
          {activeTab === 'source' && sourceUrl && (
            <img src={sourceUrl} alt="Source" className="w-full h-full object-contain" />
          )}
          {activeTab === 'depth' && depthMapUrl && (
            <img src={depthMapUrl} alt="Depth map" className="w-full h-full object-contain" />
          )}
          {activeTab === 'mask' && maskUrl && (
            <img src={maskUrl} alt="Mask" className="w-full h-full object-contain" />
          )}
          {activeTab === 'normals' && normalMapUrl && (
            <img src={normalMapUrl} alt="Normal map" className="w-full h-full object-contain" />
          )}
        </div>
      )}
    </div>
  );
}
