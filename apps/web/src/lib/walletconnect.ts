import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { useCallback, useEffect, useRef, useState } from 'react';

const SUPPORTED_CHAIN_IDS = [56, 1] as const;
const BSC_CHAIN_ID = 56;

export interface SendTransactionInput {
  chainId: number;
  to: string;
  data: string;
  value?: string;
}

type WalletProvider = Awaited<ReturnType<typeof EthereumProvider.init>>;

function walletError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  if (/reject|denied|cancel/i.test(message)) return 'Запрос отклонён в кошельке.';
  return fallback;
}

function chainIdFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sessionExpired(provider: WalletProvider): boolean {
  const expiry = (provider.session as { expiry?: number } | undefined)?.expiry;
  return Boolean(expiry && expiry * 1000 <= Date.now());
}

export function useWalletConnect(projectId: string | null) {
  const providerRef = useRef<WalletProvider | null>(null);
  const initPromiseRef = useRef<Promise<WalletProvider> | null>(null);
  const listenersBoundRef = useRef(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bindProvider = useCallback((provider: WalletProvider) => {
    if (listenersBoundRef.current) return;
    listenersBoundRef.current = true;

    provider.on('accountsChanged', (accounts: string[]) => {
      const next = accounts[0] ?? null;
      setAddress(next);
      if (!next) {
        setChainId(null);
        providerRef.current = null;
        initPromiseRef.current = null;
        listenersBoundRef.current = false;
        void provider.disconnect().catch(() => undefined);
      }
    });
    provider.on('chainChanged', (value: string) => {
      setChainId(chainIdFrom(value));
    });
    provider.on('disconnect', () => {
      setAddress(null);
      setChainId(null);
    });
  }, []);

  const ensureProvider = useCallback(async (): Promise<WalletProvider> => {
    if (!projectId) {
      throw new Error('WalletConnect Project ID не настроен');
    }
    if (providerRef.current) return providerRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    const promise = EthereumProvider.init({
      projectId,
      chains: [...SUPPORTED_CHAIN_IDS],
      optionalChains: [...SUPPORTED_CHAIN_IDS],
      showQrModal: true,
      qrModalOptions: { themeMode: 'light' },
      metadata: {
        name: 'Nexter',
        description: 'Личный финансовый учёт',
        url: window.location.origin,
        icons: [],
      },
    });

    initPromiseRef.current = promise;

    try {
      const provider = await promise;
      providerRef.current = provider;
      bindProvider(provider);
      return provider;
    } finally {
      initPromiseRef.current = null;
    }
  }, [bindProvider, projectId]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    setRestoring(true);

    void ensureProvider()
      .then(async (provider) => {
        if (cancelled || !provider.session) return;

        if (sessionExpired(provider)) {
          await provider.disconnect().catch(() => undefined);
          providerRef.current = null;
          initPromiseRef.current = null;
          listenersBoundRef.current = false;
          return;
        }

        const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string;

        if (cancelled) return;

        if (!accounts[0]) {
          await provider.disconnect().catch(() => undefined);
          providerRef.current = null;
          initPromiseRef.current = null;
          listenersBoundRef.current = false;
          setAddress(null);
          setChainId(null);
          return;
        }

        setAddress(accounts[0]);
        setChainId(chainIdFrom(currentChain));
      })
      .catch(() => {
        // A missing or expired session is not an error; the user can connect manually.
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ensureProvider, projectId]);

  const connect = useCallback(async () => {
    if (!projectId) {
      setError('WalletConnect Project ID не настроен');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      let provider = await ensureProvider();
      let accounts = provider.session
        ? ((await provider.request({ method: 'eth_accounts' })) as string[])
        : [];

      if (provider.session && (sessionExpired(provider) || !accounts[0])) {
        await provider.disconnect().catch(() => undefined);
        providerRef.current = null;
        initPromiseRef.current = null;
        listenersBoundRef.current = false;
        provider = await ensureProvider();
        accounts = [];
      }

      if (!provider.session || !accounts[0]) {
        await provider.connect();
        accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      }

      const currentChain = (await provider.request({ method: 'eth_chainId' })) as string;
      setAddress(accounts[0] ?? null);
      setChainId(chainIdFrom(currentChain));
    } catch (err) {
      setError(walletError(err, 'Не удалось подключить кошелёк'));
    } finally {
      setConnecting(false);
    }
  }, [ensureProvider, projectId]);

  const clearError = useCallback(() => setError(null), []);

  const disconnect = useCallback(async () => {
    try {
      await providerRef.current?.disconnect();
    } finally {
      providerRef.current = null;
      initPromiseRef.current = null;
      listenersBoundRef.current = false;
      setAddress(null);
      setChainId(null);
      setError(null);
      setRestoring(false);
    }
  }, []);

  const switchToChain = useCallback(async (targetChainId: number): Promise<boolean> => {
    const provider = providerRef.current;
    if (!provider) return false;

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
      setChainId(targetChainId);
      return true;
    } catch (err) {
      setError(walletError(err, 'Не удалось переключить сеть в кошельке'));
      return false;
    }
  }, []);

  const sendTransaction = useCallback(
    async (input: SendTransactionInput): Promise<string> => {
      const provider = providerRef.current;

      if (!provider || !address) {
        throw new Error('Кошелёк не подключён');
      }

      const currentChain = await provider.request({ method: 'eth_chainId' });

      if (chainIdFrom(currentChain) !== input.chainId) {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${input.chainId.toString(16)}` }],
        });
        const switchedChain = await provider.request({ method: 'eth_chainId' });

        if (chainIdFrom(switchedChain) !== input.chainId) {
          throw new Error('Кошелёк не переключился на нужную сеть');
        }
      }

      setChainId(input.chainId);

      const value =
        input.value && input.value !== '0' ? `0x${BigInt(input.value).toString(16)}` : '0x0';
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: address,
            to: input.to,
            data: input.data,
            value,
          },
        ],
      });

      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new Error('Кошелёк вернул некорректный hash транзакции');
      }

      return hash;
    },
    [address, chainId],
  );

  const waitForReceipt = useCallback(async (txHash: string, timeoutMs = 180_000) => {
    const provider = providerRef.current;

    if (!provider) {
      throw new Error('Кошелёк не подключён');
    }

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const receipt = (await provider.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      })) as { status?: string } | null;

      if (receipt) {
        if (receipt.status === '0x0' || receipt.status === '0x00') {
          throw new Error('Транзакция отклонена сетью');
        }

        return receipt;
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    throw new Error('Транзакция не подтвердилась за отведённое время');
  }, []);

  return {
    address,
    chainId,
    connecting,
    restoring,
    error,
    clearError,
    connected: Boolean(address),
    onBsc: chainId === BSC_CHAIN_ID,
    onChain: (targetChainId: number) => chainId === targetChainId,
    connect,
    disconnect,
    switchToChain,
    sendTransaction,
    waitForReceipt,
  };
}
