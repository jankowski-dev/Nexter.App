import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createFinanceAccount,
  createFinanceCategory,
  createFinanceTransaction,
  createFinanceTransfer,
  updateFinanceAccount,
  updateFinanceCategory,
  updateFinanceTransaction,
  updateFinanceTransfer,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { useState } from 'react';
import type {
  FinanceAccount,
  FinanceAccountKind,
  FinanceCategory,
  FinanceCategoryKind,
  FinanceCurrency,
  FinanceTransaction,
  FinanceTransactionKind,
  FinanceTransfer,
  FinanceTransferKind,
} from '@nexter/contracts';
import { CategoryColorPicker } from './category-color-picker';

const accountKindLabels: Record<FinanceAccountKind, string> = {
  cash: 'Наличные',
  card: 'Карта',
  bank: 'Банк',
  savings: 'Накопления',
  investment: 'Инвестиции',
  credit: 'Кредит',
};

const transferKindLabels: Record<FinanceTransferKind, string> = {
  exchange: 'Обмен валют',
  card_topup: 'Пополнение карты',
  credit: 'Кредит',
  other: 'Другое',
};

function today(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function DialogError({ error }: { error: string | null }) {
  return error ? (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {error}
    </div>
  ) : null;
}

export function FinanceTransactionDialog({
  transaction,
  kind: initialKind,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  transaction?: FinanceTransaction;
  kind?: FinanceTransactionKind;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<FinanceTransactionKind>(
    transaction?.kind ?? initialKind ?? 'expense',
  );
  const [occurredOn, setOccurredOn] = useState(transaction?.occurredOn ?? today());
  const [accountId, setAccountId] = useState(
    transaction?.accountId ?? accounts.find((account) => !account.archivedAt)?.id ?? '',
  );
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [amount, setAmount] = useState(transaction?.amount ?? '');
  const [title, setTitle] = useState(transaction?.title ?? '');
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const availableCategories = categories.filter(
    (category) =>
      category.kind === kind && (!category.archivedAt || category.id === transaction?.categoryId),
  );
  const availableAccounts = accounts.filter(
    (account) => !account.archivedAt || account.id === transaction?.accountId,
  );

  async function save(): Promise<void> {
    if (!title.trim() || !amount.trim() || !accountId) {
      setError('Заполните название, сумму и счёт.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        kind,
        occurredOn,
        accountId,
        categoryId: categoryId || null,
        amount,
        title: title.trim(),
        description: description.trim() || null,
      };
      if (transaction) await updateFinanceTransaction(transaction.id, body);
      else await createFinanceTransaction(body);
      onSaved();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось сохранить операцию'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={transaction ? 'Изменить операцию' : 'Новая операция'}
      description="Доход или расход по счёту. Переводы оформляются отдельно."
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
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Тип
            <Select
              className="mt-1"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as FinanceTransactionKind);
                setCategoryId('');
              }}
            >
              <option value="expense">Расход</option>
              <option value="income">Доход</option>
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
        <div className="grid gap-3 sm:grid-cols-2">
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
          <label className="block text-sm text-zinc-600">
            Категория
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
        </div>
        <label className="block text-sm text-zinc-600">
          Сумма
          <Input
            className="mt-1"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="block text-sm text-zinc-600">
          Название
          <Input
            className="mt-1"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Продукты, зарплата, подписка"
          />
        </label>
        <label className="block text-sm text-zinc-600">
          Описание
          <Textarea
            className="mt-1"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Необязательно"
          />
        </label>
        <DialogError error={error} />
      </div>
    </Dialog>
  );
}

export function FinanceTransferDialog({
  transfer,
  accounts,
  onClose,
  onSaved,
}: {
  transfer?: FinanceTransfer;
  accounts: FinanceAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeAccounts = accounts.filter(
    (account) =>
      !account.archivedAt ||
      account.id === transfer?.fromAccountId ||
      account.id === transfer?.toAccountId,
  );
  const [kind, setKind] = useState<FinanceTransferKind>(transfer?.kind ?? 'card_topup');
  const [occurredOn, setOccurredOn] = useState(transfer?.occurredOn ?? today());
  const [fromAccountId, setFromAccountId] = useState(
    transfer?.fromAccountId ?? activeAccounts[0]?.id ?? '',
  );
  const [toAccountId, setToAccountId] = useState(
    transfer?.toAccountId ?? activeAccounts[1]?.id ?? '',
  );
  const [fromAmount, setFromAmount] = useState(transfer?.fromAmount ?? '');
  const [toAmount, setToAmount] = useState(transfer?.toAmount ?? '');
  const [description, setDescription] = useState(transfer?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    if (!fromAccountId || !toAccountId || !fromAmount || !toAmount) {
      setError('Заполните счета и суммы.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        kind,
        occurredOn,
        fromAccountId,
        toAccountId,
        fromAmount,
        toAmount,
        description: description.trim() || null,
      };
      if (transfer) await updateFinanceTransfer(transfer.id, body);
      else await createFinanceTransfer(body);
      onSaved();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось сохранить перевод'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={transfer ? 'Изменить перевод' : 'Новый перевод'}
      description="Перевод не влияет на доходы и расходы."
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
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Тип
            <Select
              className="mt-1"
              value={kind}
              onChange={(event) => setKind(event.target.value as FinanceTransferKind)}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Откуда
            <Select
              className="mt-1"
              value={fromAccountId}
              onChange={(event) => setFromAccountId(event.target.value)}
            >
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Сумма списания
            <Input
              className="mt-1"
              inputMode="decimal"
              value={fromAmount}
              onChange={(event) => setFromAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Куда
            <Select
              className="mt-1"
              value={toAccountId}
              onChange={(event) => setToAccountId(event.target.value)}
            >
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Сумма зачисления
            <Input
              className="mt-1"
              inputMode="decimal"
              value={toAmount}
              onChange={(event) => setToAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
        </div>
        <label className="block text-sm text-zinc-600">
          Описание
          <Textarea
            className="mt-1"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Необязательно"
          />
        </label>
        <DialogError error={error} />
      </div>
    </Dialog>
  );
}

export function FinanceAccountDialog({
  account,
  onClose,
  onSaved,
}: {
  account?: FinanceAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<FinanceAccountKind>(account?.kind ?? 'card');
  const [currency, setCurrency] = useState<FinanceCurrency>(account?.currency ?? 'BYN');
  const [openingBalance, setOpeningBalance] = useState(account?.openingBalance ?? '0');
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? today());
  const [fxRate, setFxRate] = useState(account?.fxRate ?? '1');
  const [creditLimit, setCreditLimit] = useState(account?.creditLimit ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    if (!name.trim()) {
      setError('Укажите название счёта.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        name: name.trim(),
        kind,
        currency,
        openingBalance,
        openingDate,
        fxRate,
        creditLimit: creditLimit.trim() || null,
      };
      if (account) await updateFinanceAccount(account.id, body);
      else await createFinanceAccount(body);
      onSaved();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось сохранить счёт'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? 'Изменить счёт' : 'Новый счёт'}
      description="Начальный остаток — это баланс на дату начала учёта."
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
      <div className="space-y-3">
        <label className="block text-sm text-zinc-600">
          Название
          <Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Тип
            <Select
              className="mt-1"
              value={kind}
              onChange={(event) => setKind(event.target.value as FinanceAccountKind)}
            >
              {Object.entries(accountKindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Валюта
            <Select
              className="mt-1"
              value={currency}
              onChange={(event) => {
                const next = event.target.value as FinanceCurrency;
                setCurrency(next);
                setFxRate(next === 'BYN' ? '1' : '');
              }}
            >
              <option value="BYN">BYN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Начальный остаток
            <Input
              className="mt-1"
              inputMode="decimal"
              value={openingBalance}
              onChange={(event) => setOpeningBalance(event.target.value)}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Дата начала
            <Input
              className="mt-1"
              type="date"
              value={openingDate}
              onChange={(event) => setOpeningDate(event.target.value)}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Курс к BYN
            <Input
              className="mt-1"
              inputMode="decimal"
              value={currency === 'BYN' ? '1' : fxRate}
              disabled={currency === 'BYN'}
              onChange={(event) => setFxRate(event.target.value)}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Кредитный лимит
            <Input
              className="mt-1"
              inputMode="decimal"
              value={creditLimit}
              onChange={(event) => setCreditLimit(event.target.value)}
              placeholder="Необязательно"
            />
          </label>
        </div>
        <DialogError error={error} />
      </div>
    </Dialog>
  );
}

export function FinanceCategoryDialog({
  category,
  kind: initialKind,
  onClose,
  onSaved,
}: {
  category?: FinanceCategory;
  kind?: FinanceCategoryKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<FinanceCategoryKind>(category?.kind ?? initialKind ?? 'expense');
  const [color, setColor] = useState(category?.color ?? 'gray');
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    if (!name.trim()) {
      setError('Укажите название категории.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (category) {
        await updateFinanceCategory(category.id, {
          name: name.trim(),
          color,
          icon: icon.trim() || null,
        });
      } else {
        await createFinanceCategory({
          name: name.trim(),
          kind,
          color,
          icon: icon.trim() || null,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось сохранить категорию'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={category ? 'Изменить категорию' : 'Новая категория'}
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
      <div className="space-y-3">
        <label className="block text-sm text-zinc-600">
          Название
          <Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {!category ? (
          <label className="block text-sm text-zinc-600">
            Тип
            <Select
              className="mt-1"
              value={kind}
              onChange={(event) => setKind(event.target.value as FinanceCategoryKind)}
            >
              <option value="expense">Расход</option>
              <option value="income">Доход</option>
            </Select>
          </label>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <CategoryColorPicker value={color} onChange={setColor} />
          <label className="block text-sm text-zinc-600">
            Иконка
            <Input
              className="mt-1"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              placeholder="emoji или имя"
            />
          </label>
        </div>
        <DialogError error={error} />
      </div>
    </Dialog>
  );
}
