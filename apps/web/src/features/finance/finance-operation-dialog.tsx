import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { ExpressionInput } from '@/components/ui/expression-input';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createFinanceTransaction,
  createFinanceTransfer,
  fetchFinanceCategorySuggestions,
  updateFinanceTransaction,
  updateFinanceTransfer,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { normalizeAmountInput } from '@/lib/expression';
import type {
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionKind,
  FinanceTransfer,
  FinanceTransferKind,
} from '@nexter/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  operationKindLabels,
  resolveOperationTitle,
  type FinanceOperationKind,
} from './finance-operation';
import { categoryColorClass } from './category-colors';

const transferKindLabels: Record<FinanceTransferKind, string> = {
  exchange: 'Обмен валют',
  card_topup: 'Пополнение карты',
  credit: 'Кредит / погашение',
  other: 'Другое',
};

function today(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function financeError(error: string | null) {
  return error ? (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {error}
    </div>
  ) : null;
}

function OperationTypeSwitch({
  value,
  onChange,
  disabled,
}: {
  value: FinanceOperationKind;
  onChange: (value: FinanceOperationKind) => void;
  disabled: boolean;
}) {
  const kinds: FinanceOperationKind[] = ['expense', 'income', 'transfer'];
  const index = Math.max(0, kinds.indexOf(value));

  return (
    <div className="relative grid grid-cols-3 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-white shadow-sm transition-transform duration-200"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={disabled}
          aria-pressed={value === kind}
          onClick={() => onChange(kind)}
          className={`relative z-10 rounded-lg px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed ${
            value === kind ? 'font-medium text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          {operationKindLabels[kind]}
        </button>
      ))}
    </div>
  );
}

export function FinanceOperationDialog({
  kind: initialKind = 'expense',
  transaction,
  transfer,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  kind?: FinanceOperationKind;
  transaction?: FinanceTransaction;
  transfer?: FinanceTransfer;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const locked = Boolean(transaction || transfer);
  const [kind, setKind] = useState<FinanceOperationKind>(
    transfer ? 'transfer' : (transaction?.kind ?? initialKind),
  );
  const [occurredOn, setOccurredOn] = useState(
    transaction?.occurredOn ?? transfer?.occurredOn ?? today(),
  );
  const [accountId, setAccountId] = useState(
    transaction?.accountId ?? accounts.find((account) => !account.archivedAt)?.id ?? '',
  );
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [amount, setAmount] = useState(transaction?.amount ?? '');
  const [title, setTitle] = useState(transaction?.title ?? '');
  const [transferKind, setTransferKind] = useState<FinanceTransferKind>(
    transfer?.kind ?? 'card_topup',
  );
  const [fromAccountId, setFromAccountId] = useState(
    transfer?.fromAccountId ?? accounts.find((account) => !account.archivedAt)?.id ?? '',
  );
  const [toAccountId, setToAccountId] = useState(
    transfer?.toAccountId ?? accounts.filter((account) => !account.archivedAt)[1]?.id ?? '',
  );
  const [fromAmount, setFromAmount] = useState(transfer?.fromAmount ?? '');
  const [toAmount, setToAmount] = useState(transfer?.toAmount ?? '');
  const [description, setDescription] = useState(
    transaction?.description ?? transfer?.description ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const availableAccounts = accounts.filter(
    (account) =>
      !account.archivedAt ||
      account.id === transaction?.accountId ||
      account.id === transfer?.fromAccountId ||
      account.id === transfer?.toAccountId,
  );
  const availableCategories = categories.filter(
    (category) =>
      category.kind === kind && (!category.archivedAt || category.id === transaction?.categoryId),
  );
  const suggestions = useQuery({
    queryKey: ['finance-category-suggestions', kind],
    queryFn: () => fetchFinanceCategorySuggestions(kind === 'income' ? 'income' : 'expense', 5),
    enabled: kind !== 'transfer',
    staleTime: 60_000,
  });
  const quickCategories = (suggestions.data?.categories ?? availableCategories)
    .filter((category) => category.kind === kind)
    .slice(0, 5);
  const selectedCategory = availableCategories.find((category) => category.id === categoryId);
  const selectedFrom = accounts.find((account) => account.id === fromAccountId);
  const selectedTo = accounts.find((account) => account.id === toAccountId);

  function changeKind(next: FinanceOperationKind): void {
    if (locked || next === kind) return;
    setKind(next);
    setCategoryId('');
  }

  function changeFromAmount(value: string): void {
    setFromAmount(value);
    if (selectedFrom && selectedTo && selectedFrom.currency === selectedTo.currency) {
      setToAmount(value);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      if (kind === 'transfer') {
        const normalizedFrom = normalizeAmountInput(fromAmount);
        const normalizedTo = normalizeAmountInput(toAmount);
        if (!fromAccountId || !toAccountId || !normalizedFrom || !normalizedTo) {
          setError('Заполните счета и суммы.');
          return;
        }
        const body = {
          kind: transferKind,
          occurredOn,
          fromAccountId,
          toAccountId,
          fromAmount: normalizedFrom,
          toAmount: normalizedTo,
          description: description.trim() || null,
        };
        if (transfer) await updateFinanceTransfer(transfer.id, body);
        else await createFinanceTransfer(body);
      } else {
        const normalizedAmount = normalizeAmountInput(amount);
        if (!normalizedAmount || !accountId) {
          setError('Заполните сумму и счёт.');
          return;
        }
        const body = {
          kind: kind as FinanceTransactionKind,
          occurredOn,
          accountId,
          categoryId: categoryId || null,
          amount: normalizedAmount,
          title: resolveOperationTitle(
            title,
            selectedCategory?.name,
            kind as FinanceTransactionKind,
          ),
          description: description.trim() || null,
        };
        if (transaction) await updateFinanceTransaction(transaction.id, body);
        else await createFinanceTransaction(body);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось сохранить операцию'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={transfer ? 'Изменить перевод' : transaction ? 'Изменить операцию' : 'Новая операция'}
      description={
        locked
          ? 'Тип операции у существующей записи изменить нельзя.'
          : 'Расход, доход или перевод. Поля меняются в зависимости от типа.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <OperationTypeSwitch value={kind} onChange={changeKind} disabled={locked} />

        {kind === 'transfer' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-600">
                Откуда
                <Select
                  className="mt-1"
                  value={fromAccountId}
                  onChange={(event) => setFromAccountId(event.target.value)}
                >
                  {availableAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.currency}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm text-zinc-600">
                Куда
                <Select
                  className="mt-1"
                  value={toAccountId}
                  onChange={(event) => setToAccountId(event.target.value)}
                >
                  {availableAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.currency}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-600">
                Сумма списания
                <ExpressionInput
                  className="mt-1"
                  value={fromAmount}
                  onChange={changeFromAmount}
                  placeholder="0.00"
                />
              </label>
              <label className="block text-sm text-zinc-600">
                Сумма зачисления
                <ExpressionInput
                  className="mt-1"
                  value={toAmount}
                  onChange={setToAmount}
                  placeholder="0.00"
                />
                {selectedFrom && selectedTo ? (
                  <span className="mt-1 block text-[11px] text-zinc-500">
                    {selectedFrom.currency === selectedTo.currency
                      ? 'Одинаковая валюта: сумма подставляется автоматически.'
                      : `Курсы счетов: ${selectedFrom.currency} → ${selectedTo.currency}. Проверьте сумму зачисления.`}
                  </span>
                ) : null}
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-600">
                Тип перевода
                <Select
                  className="mt-1"
                  value={transferKind}
                  onChange={(event) => setTransferKind(event.target.value as FinanceTransferKind)}
                >
                  {Object.entries(transferKindLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm text-zinc-600">
                Дата
                <Input
                  className="mt-1"
                  type="date"
                  value={occurredOn}
                  onChange={(event) => setOccurredOn(event.target.value)}
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
              <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Сумма
                <ExpressionInput
                  className="mt-1 h-12 text-2xl font-semibold"
                  value={amount}
                  onChange={setAmount}
                  placeholder="0.00"
                />
              </label>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Быстрый выбор категории
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {quickCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(category.id);
                      if (!title.trim()) setTitle(category.name);
                    }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      categoryId === category.id
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-200'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${categoryColorClass[category.color ?? 'default'] ?? categoryColorClass.default}`}
                    />
                    {category.name}
                  </button>
                ))}
                {quickCategories.length === 0 ? (
                  <span className="text-xs text-zinc-500">Категорий пока нет.</span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-600">
                Все категории
                <Select
                  className="mt-1"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Без категории</option>
                  {availableCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm text-zinc-600">
                Счёт
                <Select
                  className="mt-1"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  {availableAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.currency}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-600">
                Название
                <Input
                  className="mt-1"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={selectedCategory?.name ?? 'Например, продукты'}
                />
                <span className="mt-1 block text-[11px] text-zinc-500">
                  Можно не заполнять: подставится категория или тип.
                </span>
              </label>
              <label className="block text-sm text-zinc-600">
                Дата
                <Input
                  className="mt-1"
                  type="date"
                  value={occurredOn}
                  onChange={(event) => setOccurredOn(event.target.value)}
                />
              </label>
            </div>
          </>
        )}

        <label className="block text-sm text-zinc-600">
          Описание
          <Textarea
            className="mt-1"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Необязательно"
          />
        </label>
        {financeError(error)}
      </div>
    </Drawer>
  );
}
