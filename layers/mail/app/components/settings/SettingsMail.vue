<script setup lang="ts">
import { normalizeTrustedImageSender } from '#layers/mail/shared/mail-images'
import { isValidLabelName } from '#layers/mail/shared/mail-labels'
import type { MailSettings } from '#layers/mail/shared/types/settings'

const { trustedImageSenders, trust, untrust } = useTrustedImageSenders()
const { senderAddresses, add: addSender, remove: removeSender } = useMailSenderAddresses()
const { data: services } = useServices()
const { data: mailSettings, save: saveMailSettings } = useSettings<MailSettings>('mail')

// The done label is edited in place; a blank or invalid name is refused and the
// saved one shown again
const doneLabel = ref(mailSettings.value.doneLabel ?? 'Done')
const doneLabelError = ref('')

watch(mailSettings, (settings) => {
  doneLabel.value = settings.doneLabel ?? 'Done'
})

async function saveDoneLabel() {
  const label = doneLabel.value.trim()
  if (!isValidLabelName(label)) {
    doneLabelError.value = 'Enter a label name without "/" or "..".'
    return
  }

  doneLabelError.value = ''
  doneLabel.value = label
  await saveMailSettings({
    trustedImageSenders: mailSettings.value.trustedImageSenders ?? [],
    listView: mailSettings.value.listView ?? 'mails',
    senderAddresses: mailSettings.value.senderAddresses ?? {},
    doneLabel: label
  })
}

const mailServices = computed(() => services.value.filter(service => service.domain === 'mail'))

// The address typed for each account, and the reason the last add failed
const entries = reactive<Record<string, string>>({})
const errors = reactive<Record<string, string>>({})

const entry = ref('')
const error = ref('')

function add() {
  const normalized = normalizeTrustedImageSender(entry.value)
  if (!normalized) {
    error.value = 'Enter an email address or a domain such as @example.com.'
    return
  }
  if (trustedImageSenders.value.includes(normalized)) {
    error.value = 'This sender is already trusted.'
    return
  }

  error.value = ''
  entry.value = ''
  void trust(normalized)
}

function remove(value: string) {
  void untrust(value)
}

async function addSenderAddress(serviceId: string) {
  const problem = await addSender(serviceId, entries[serviceId])
  if (problem) {
    errors[serviceId] = problem
    return
  }

  errors[serviceId] = ''
  entries[serviceId] = ''
}
</script>

<template>
  <div class="max-w-xl space-y-6">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Done label
          </h2>
          <p class="text-sm text-muted">
            The label that marks a mail as done. Pressing <UKbd>e</UKbd> adds it and marks the mail
            read; pressing it again removes the label and leaves the mail where it is.
          </p>
        </div>
      </template>

      <UFormField label="Label name" :error="doneLabelError || undefined">
        <div class="flex items-start gap-2">
          <UInput
            v-model="doneLabel"
            icon="i-lucide-tag"
            placeholder="Done"
            class="min-w-0 flex-1"
            @keyup.enter="saveDoneLabel"
          />
          <UButton
            label="Save"
            icon="i-lucide-check"
            :disabled="!doneLabel.trim() || doneLabel === mailSettings.doneLabel"
            @click="saveDoneLabel"
          />
        </div>
      </UFormField>
    </UCard>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Remote images
          </h2>
          <p class="text-sm text-muted">
            Loading remote images tells the sender that you opened the mail, and when. The images are
            fetched from the sender's server, which can identify you. Trusted senders and domains load
            their images automatically; scripts and plain HTTP content stay blocked either way.
          </p>
        </div>
      </template>

      <div class="space-y-4">
        <div v-if="trustedImageSenders.length" class="divide-y divide-default">
          <div
            v-for="trusted in trustedImageSenders"
            :key="trusted"
            class="flex items-center justify-between gap-2 py-2"
          >
            <span class="min-w-0 truncate text-sm text-highlighted">{{ trusted }}</span>
            <UButton
              label="Remove"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Stop trusting ${trusted}`"
              @click="remove(trusted)"
            />
          </div>
        </div>
        <p v-else class="text-sm text-muted">
          No senders or domains are trusted yet.
        </p>

        <div class="flex items-start gap-2">
          <UFormField
            label="Add a sender or domain"
            :error="error || undefined"
            class="min-w-0 flex-1"
          >
            <UInput
              v-model="entry"
              icon="i-lucide-at-sign"
              placeholder="someone@example.com or @example.com"
              class="w-full"
              @keyup.enter="add"
            />
          </UFormField>
          <UButton
            label="Add"
            icon="i-lucide-plus"
            :disabled="!entry.trim()"
            class="mt-6"
            @click="add"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Send as
          </h2>
          <p class="text-sm text-muted">
            Proton does not tell the dashboard which aliases an account has. Add an address here and
            it appears in the From list of new mails and replies. Sending from an address the account
            does not own fails at the mail server.
          </p>
        </div>
      </template>

      <div class="space-y-6">
        <div v-for="service in mailServices" :key="service.id" class="space-y-3">
          <h3 class="text-sm font-medium text-highlighted">
            {{ service.name }}
          </h3>

          <div v-if="senderAddresses[service.id]?.length" class="divide-y divide-default">
            <div
              v-for="address in senderAddresses[service.id]"
              :key="address"
              class="flex items-center justify-between gap-2 py-2"
            >
              <span class="min-w-0 truncate text-sm text-highlighted">{{ address }}</span>
              <UButton
                label="Remove"
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Remove ${address}`"
                @click="removeSender(service.id, address)"
              />
            </div>
          </div>
          <p v-else class="text-sm text-muted">
            No extra addresses.
          </p>

          <div class="flex items-start gap-2">
            <UFormField
              label="Add an address"
              :error="errors[service.id] || undefined"
              class="min-w-0 flex-1"
            >
              <UInput
                v-model="entries[service.id]"
                icon="i-lucide-at-sign"
                placeholder="alias@example.com"
                class="w-full"
                @keyup.enter="addSenderAddress(service.id)"
              />
            </UFormField>
            <UButton
              label="Add"
              icon="i-lucide-plus"
              :disabled="!(entries[service.id] ?? '').trim()"
              class="mt-6"
              @click="addSenderAddress(service.id)"
            />
          </div>
        </div>

        <p v-if="!mailServices.length" class="text-sm text-muted">
          No mail account is configured yet.
        </p>
      </div>
    </UCard>
  </div>
</template>
