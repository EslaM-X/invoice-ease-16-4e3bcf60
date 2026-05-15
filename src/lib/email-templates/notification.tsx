import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Button, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Steinheim Suite'

interface NotificationEmailProps {
  title?: string
  body?: string
  link?: string
  actionUrl?: string
}

const NotificationEmail = ({ title, body, actionUrl }: NotificationEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>{title || `إشعار جديد من ${SITE_NAME}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brand}>
          <Text style={brandText}>{SITE_NAME}</Text>
        </Section>
        <Heading style={h1}>{title || 'إشعار جديد'}</Heading>
        {body ? <Text style={text}>{body}</Text> : null}
        {actionUrl ? (
          <Section style={{ textAlign: 'center', margin: '28px 0 8px' }}>
            <Button href={actionUrl} style={btn}>فتح في التطبيق</Button>
          </Section>
        ) : null}
        <Hr style={hr} />
        <Text style={footer}>
          هذه رسالة تلقائية من {SITE_NAME}. لمتابعة كل التحديثات افتح التطبيق.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NotificationEmail,
  subject: (d: Record<string, any>) => d?.title || `إشعار جديد من ${SITE_NAME}`,
  displayName: 'إشعار النظام',
  previewData: {
    title: '🚚 شحنة في الطريق — PO-2026-0001',
    body: 'وصلت حالة الشحنة إلى: في الطريق. الكمية: 50.',
    actionUrl: 'https://admin.steinheim-eg.com/purchase-orders',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px', margin: '0 auto' }
const brand = { textAlign: 'center' as const, marginBottom: '16px' }
const brandText = { fontSize: '13px', color: '#888', letterSpacing: '1px', margin: 0 }
const h1 = { fontSize: '20px', fontWeight: 'bold' as const, color: '#0b0b0c', margin: '0 0 14px', textAlign: 'right' as const }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.7', margin: '0 0 12px', textAlign: 'right' as const }
const btn = { backgroundColor: '#0b0b0c', color: '#fff', padding: '12px 22px', borderRadius: '10px', fontSize: '14px', textDecoration: 'none' }
const hr = { border: 'none', borderTop: '1px solid #ececec', margin: '28px 0 14px' }
const footer = { fontSize: '12px', color: '#999', textAlign: 'right' as const, margin: 0 }
