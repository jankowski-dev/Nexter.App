import { fetchSwapConfig } from '@/lib/api';
import { useWalletConnect } from '@/lib/walletconnect';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SendTransactionInput } from '@/lib/walletconnect';

export type WalletChain = 'bsc' | 'ethereum';

const CHAIN_IDS: Record<WalletChain, number> = {
  bsc: 56,
  ethereum: 1,
};

interface WalletContextValue {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  connected: boolean;
  error: string | null;
  projectId: string | null;
  chain: WalletChain;
  selectChain: (chain: WalletChain) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearError: () => void;
  sendTransaction: (input: SendTransactionInput) => Promise<string>;
  waitForReceipt: (txHash: string, timeoutMs?: number) => Promise<unknown>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const config = useQuery({
    queryKey: ['swap-config'],
    queryFn: fetchSwapConfig,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const projectId = config.data?.walletConnectProjectId ?? null;
  const wallet = useWalletConnect(projectId);
  const [chain, setChain] = useState<WalletChain>('bsc');
  const wasConnected = useRef(false);

  useEffect(() => {
    if (wallet.connected && !wasConnected.current) {
      const target = CHAIN_IDS[chain];
      if (wallet.chainId !== target) {
        void wallet.switchToChain(target).then((switched) => {
          if (!switched) setChain('bsc');
        });
      }
    }
    wasConnected.current = wallet.connected;
  }, [wallet.connected, wallet.chainId, wallet.switchToChain, chain]);

  const selectChain = useCallback(
    (next: WalletChain) => {
      const previous = chain;
      setChain(next);
      if (wallet.connected && wallet.chainId !== CHAIN_IDS[next]) {
        void wallet.switchToChain(CHAIN_IDS[next]).then((switched) => {
          if (!switched) {
            setChain((current) => (current === next ? previous : current));
          }
        });
      }
    },
    [chain, wallet.connected, wallet.chainId, wallet.switchToChain],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      address: wallet.address,
      chainId: wallet.chainId,
      connecting: wallet.connecting,
      connected: wallet.connected,
      error: wallet.error,
      projectId,
      chain,
      selectChain,
      connect: wallet.connect,
      disconnect: wallet.disconnect,
      clearError: wallet.clearError,
      sendTransaction: wallet.sendTransaction,
      waitForReceipt: wallet.waitForReceipt,
    }),
    [
      wallet.address,
      wallet.chainId,
      wallet.connecting,
      wallet.connected,
      wallet.error,
      projectId,
      chain,
      selectChain,
      wallet.connect,
      wallet.disconnect,
      wallet.clearError,
      wallet.sendTransaction,
      wallet.waitForReceipt,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}

export function walletChainId(chain: WalletChain): number {
  return CHAIN_IDS[chain];
}
