import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { useCallback, useRef, useState } from 'react';

const BSC_CHAIN_ID = 56;
type WalletProvider = Awaited<ReturnType<typeof EthereumProvider.init>>;

function chainIdFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function useWalletConnect(projectId: string | null) {
  const providerRef = useRef<WalletProvider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (!projectId) {
      setError('WalletConnect Project ID не настроен');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const provider =
        providerRef.current ??
        (await EthereumProvider.init({
          projectId,
          chains: [BSC_CHAIN_ID],
          optionalChains: [BSC_CHAIN_ID],
          showQrModal: true,
          metadata: {
            name: 'Nexter',
            description: 'Личный финансовый учёт',
            url: window.location.origin,
            icons: [],
          },
        }));

      providerRef.current = provider;

      provider.on('accountsChanged', (accounts: string[]) => {
        setAddress(accounts[0] ?? null);
      });
      provider.on('chainChanged', (value: string) => {
        setChainId(chainIdFrom(value));
      });
      provider.on('disconnect', () => {
        setAddress(null);
        setChainId(null);
      });

      if (!provider.session) {
        await provider.connect();
      }

      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      const currentChain = (await provider.request({ method: 'eth_chainId' })) as string;
      setAddress(accounts[0] ?? null);
      setChainId(chainIdFrom(currentChain));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подключить кошелёк');
    } finally {
      setConnecting(false);
    }
  }, [projectId]);

  const disconnect = useCallback(async () => {
    try {
      await providerRef.current?.disconnect();
    } finally {
      providerRef.current = null;
      setAddress(null);
      setChainId(null);
      setError(null);
    }
  }, []);

  const switchToBsc = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return;

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x38' }],
      });
      setChainId(BSC_CHAIN_ID);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось переключить сеть на BSC');
    }
  }, []);

  return {
    address,
    chainId,
    connecting,
    error,
    connected: Boolean(address),
    onBsc: chainId === BSC_CHAIN_ID,
    connect,
    disconnect,
    switchToBsc,
  };
}
