<template>
  <span
    class="grid gap-6 animate-[fadeIn_.7s_ease-in-out_forwards]"
    ref="component"
  >
    <label class="hs-form-field is-filled is-large">
      <span class="hs-form-field__label">{{ i18n('Email') }}</span>
      <input
        class="hs-form-field__input"
        :placeholder="i18n('EmailPlaceholder')"
        :data-is-filled="Boolean(customerEmail)"
        v-model="customerEmail"
        type="email"
        :disabled="loading || waitingForMinted"
      />
    </label>

    <label class="hs-form-field is-filled is-large">
      <span class="hs-form-field__label">{{ i18n('FullName') }}</span>
      <input
        class="hs-form-field__input"
        :placeholder="i18n('FullNamePlaceholder')"
        :data-is-filled="Boolean(customerName)"
        v-model="customerName"
        type="text"
        :disabled="loading || waitingForMinted"
      />
    </label>

    <span class="grid">
      <button
        @click="clickHandler"
        :disabled="
          !account ||
          !customerEmail ||
          !customerName ||
          loading ||
          waitingForMinted ||
          Boolean(error)
        "
        class="hs-button relative group is-large is-filled"
        :class="{ 'animate-pulse': loading, 'bg-red-600': error }"
      >
        <IconBouncingArrowRight
          v-if="!loading"
          :justifyLeft="true"
          class="group-disabled:hidden"
        />
        <IconSpinner v-if="loading" class="absolute left-5 size-5" />
        {{ i18n('PayWithACreditCard') }}
      </button>

      <p
        v-if="error"
        class="text-bold mt-2 rounded-md bg-red-600 p-2 text-white"
      >
        {{ error }}
      </p>
    </span>

    <span
      v-if="waitingForMinted"
      class="fixed inset-0 flex items-center justify-center bg-black/30"
    >
      <span
        class="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white p-4 size-52 shadow"
      >
        <video :src="PosMp4" autoplay loop muted playsinline class="size-32" />
        <p class="text-sm text-black/50">{{ i18n('Waiting') }}</p>
      </span>
    </span>
  </span>
</template>

<script lang="ts" setup>
import { ref, onMounted, useTemplateRef } from 'vue'
import type { Failure, Success } from './api/payment-key'
import type { ComposedItem } from './types'
import { whenDefined, whenDefinedAll, whenNotError } from '@devprotocol/util-ts'
import { JsonRpcProvider } from 'ethers'
import { clientsSTokens } from '@devprotocol/dev-kit'
import {
  bytes32Hex,
  i18nFactory,
  mintedIdByLogs,
} from '@devprotocol/clubs-core'
import { IconBouncingArrowRight } from '@devprotocol/clubs-core/ui/vue'
import { Strings } from './i18n'
import PosMp4 from './images/pos-terminal.mp4'

const props = defineProps<{
  item: ComposedItem
  chainId: number
  rpcUrl: string
  debugMode: boolean
  base: string
}>()

const account = ref<string | undefined>(undefined)
const customerEmail = ref<string | undefined>(undefined)
const customerName = ref<string | undefined>(undefined)
const loading = ref(false)
const error = ref<string | undefined>(undefined)
const component = useTemplateRef('component')
const waitingForMinted = ref(false)
const i18nBase = i18nFactory(Strings)
const i18n = ref(i18nBase(['en']))
const dialog = ref<HTMLDialogElement>()

onMounted(async () => {
  i18n.value = i18nBase(navigator.languages)
  const { connection } = await import('@devprotocol/clubs-core/connection')

  connection().account.subscribe(async (acc) => {
    account.value = acc
  })

  dialog.value = document.createElement('dialog')
})

const onError = (msg: string) => {
  error.value = msg
  setTimeout(() => {
    error.value = undefined
  }, 6000)
}

const waitForMinted = async () => {
  const provider = new JsonRpcProvider(props.rpcUrl)
  const blockNumber = await provider.getBlockNumber()
  const [l1, l2] = await clientsSTokens(provider)
  const client = l1 ?? l2
  const sTokens = client?.contract()
  return new Promise<bigint>(async (res, rej) => {
    const polling = setInterval(async () => {
      const event = await whenDefined(sTokens, (c) =>
        c
          .queryFilter(c.filters.Minted, blockNumber)
          .catch((err) => new Error(err)),
      )
      const result = await whenNotError(event, (eve) =>
        whenDefinedAll(
          [eve, client, account.value],
          ([ev, sTokensManager, receipent]) =>
            mintedIdByLogs(ev, {
              sTokensManager,
              receipent,
              payload: props.item.payload,
            }).catch((err) => new Error(err)),
        ),
      )
      console.log({ blockNumber, event, id: result })
      if (result instanceof Error) {
        clearInterval(polling)
        return rej(result)
      }
      if (result) {
        clearInterval(polling)
        return res(result)
      }
    }, 500)
  })
}

const getCCForm = () => document.querySelector('iframe#pop-veritrans')

const clickHandler = async () => {
  const pop = (window as { pop?: any }).pop ?? new Error('Library error')
  const params = whenNotError(
    pop,
    () =>
      whenDefinedAll(
        [
          props.item.payload,
          account.value,
          customerName.value,
          customerEmail.value,
        ],
        ([payload_, account_, customerName_, customerEmail_]) => ({
          payload: payload_,
          account: account_,
          customerName: customerName_,
          customerEmail: customerEmail_,
          dummy: props.debugMode,
        }),
      ) ?? new Error('Required fields missing'),
  )

  loading.value = true

  const paymentKeyApi = whenNotError(
    params,
    ({ payload, account, customerName, customerEmail, dummy }) => {
      const url = new URL(
        `${props.base}/api/devprotocol:clubs:plugin:clubs-payments/payment-key`,
      )
      url.searchParams.set('payload', bytes32Hex(payload))
      url.searchParams.set('eoa', account)
      url.searchParams.set('email.customer_name', customerName)
      url.searchParams.set('email.customer_email_address', customerEmail)
      url.searchParams.set('dummy', String(dummy))
      return url
    },
  )
  const res = await whenNotError(paymentKeyApi, (api) =>
    fetch(api, {
      headers: { 'Content-Type': 'application/json' },
    }).catch((err: Error) => err),
  )

  const data = await whenNotError(res, async (result) =>
    result.ok
      ? ((await result.json()) as Success | Failure)
      : new Error('Request error has occurred'),
  )

  console.log(data)

  const paymentKey = whenNotError(data, (d) =>
    d.status === 'success' ? d.payment_key : new Error(d.message),
  )

  pop.show()
  const ccForm = getCCForm()
  whenDefinedAll([dialog.value, ccForm], ([dia, form]) => {
    if (!document.body.contains(dia)) {
      document.body.appendChild(dia)
    }
    dia.append(form)
    dia.showModal()
  })

  const pay = await whenNotError(paymentKey, (key) =>
    new Promise<{}>((resolve, reject) => {
      pop.pay(key, {
        skipOrderSummary: true,
        autoReturn: true,
        language: 'en', //'en' | 'ja' | 'zh'
        onSuccess: function (result: any) {
          console.log('success')
          console.log(result)
          waitingForMinted.value = true
          return resolve(result as {})
        },
        onFailure: function (result: any) {
          console.log('failure')
          console.log(result)
          return reject(new Error(`${result.result_code}: ${result.status}`))
        },
        onIncomplete: function (result: any) {
          console.log('incomplete')
          console.log(result)
          return reject(new Error(`${result.status}`))
        },
      })
    }).catch((err: Error) => err),
  )

  whenDefined(dialog.value, (dia) => {
    dia.close()
  })

  loading.value = false

  const result = await whenNotError(pay, waitForMinted)

  waitingForMinted.value = false

  console.log('component.value', component.value)

  return result instanceof Error
    ? onError(result.message)
    : component.value?.dispatchEvent(
        new CustomEvent('checkout:completed', {
          detail: { id: result },
          bubbles: true,
        }),
      )
}
</script>

<style scoped>
@keyframes fadeIn {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 100;
  }
}
</style>
