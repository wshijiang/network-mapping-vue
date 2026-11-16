import assert from 'node:assert/strict'
import test from 'node:test'
import { addCalendarDays, applyTimeSettings, calendarDate, calendarMidnight, formatDateTime, localTimeCandidates, localToIso, mondayDate, timezoneOffsetLabel, toLocalInputValue } from './systemTime.js'
import { reportCsv, reportPeriod } from './reports.js'

test('Shanghai stays UTC+8 in both seasons and ignores host timezone', () => {
  for (const month of ['01', '07']) {
    assert.equal(localToIso(`2026-${month}-15T09:00`, 'Asia/Shanghai'), `2026-${month}-15T01:00:00.000Z`)
  }
  assert.equal(calendarDate('2026-09-30T16:00:00Z', 'Asia/Shanghai'), '2026-10-01')
})

test('named timezones include DST and fractional hour offsets', () => {
  assert.equal(localToIso('2026-01-15T09:00', 'America/New_York'), '2026-01-15T14:00:00.000Z')
  assert.equal(localToIso('2026-07-15T09:00', 'America/New_York'), '2026-07-15T13:00:00.000Z')
  assert.equal(localToIso('2026-01-15T09:00', 'Asia/Kathmandu'), '2026-01-15T03:15:00.000Z')
})

test('nonexistent local times and invalid dates are rejected', () => {
  assert.throws(() => localToIso('2026-03-08T02:30', 'America/New_York'), /不存在/)
  assert.throws(() => localToIso('2026-02-30T12:00', 'Asia/Shanghai'), /不存在/)
})

test('repeated local times require an explicit offset choice', () => {
  const local = '2026-11-01T01:30'
  const choices = localTimeCandidates(local, 'America/New_York')
  assert.equal(choices.length, 2)
  assert.throws(() => localToIso(local, 'America/New_York'), /两次/)
  assert.equal(localToIso(`${local}@${choices[0].timestamp}`, 'America/New_York'), '2026-11-01T05:30:00.000Z')
  assert.equal(localToIso(`${local}@${choices[1].timestamp}`, 'America/New_York'), '2026-11-01T06:30:00.000Z')
})

test('calendar boundaries and display settings update without moving instants', () => {
  applyTimeSettings({ revision: 1, document: { timezone: 'America/New_York', hourCycle: '24', dateFormat: 'YYYY-MM-DD' } })
  assert.equal(formatDateTime('2026-01-15T14:00:00Z'), '2026-01-15 09:00:00')
  assert.equal(calendarMidnight('2026-03-08'), '2026-03-08T05:00:00.000Z')
  assert.equal(calendarMidnight('2026-03-09'), '2026-03-09T04:00:00.000Z')
  assert.equal(mondayDate('2026-09-30T12:00:00Z'), '2026-09-28')
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29')
  for (const instant of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) assert.equal(localToIso(toLocalInputValue(instant)), new Date(instant).toISOString())
  applyTimeSettings({ revision: 2, document: { timezone: 'Asia/Shanghai', hourCycle: '24', dateFormat: 'DD/MM/YYYY' } })
  assert.equal(formatDateTime('2026-01-15T01:00:00Z'), '15/01/2026 09:00:00')
  // A stale response cannot revert published preferences.
  applyTimeSettings({ revision: 1, document: { timezone: 'UTC', hourCycle: '12', dateFormat: 'YYYY-MM-DD' } })
  assert.equal(calendarDate('2026-01-15T16:00:00Z'), '2026-01-16')
})

test('archived reports preserve timezone when global preferences change', () => {
  const report = { timezone: 'America/New_York', period_type: 'weekly', revision: 1, period_start: '2026-09-21T04:00:00Z', period_end: '2026-09-28T04:00:00Z', payload: {} }
  assert.equal(reportPeriod(report), '21/09/2026 至 28/09/2026（不含）')
  assert.ok(reportCsv(report).includes('"时区","America/New_York"'))
})

test('timezoneOffsetLabel gives a short DST-aware UTC offset per instant', () => {
  assert.equal(timezoneOffsetLabel('2026-01-15T01:00:00Z', 'Asia/Shanghai'), 'UTC+8')
  assert.equal(timezoneOffsetLabel('2026-07-15T01:00:00Z', 'Asia/Shanghai'), 'UTC+8')
  assert.equal(timezoneOffsetLabel('2026-01-15T14:00:00Z', 'America/New_York'), 'UTC-5')
  assert.equal(timezoneOffsetLabel('2026-07-15T13:00:00Z', 'America/New_York'), 'UTC-4')
  assert.equal(timezoneOffsetLabel('2026-01-15T03:15:00Z', 'Asia/Kathmandu'), 'UTC+5:45')
  assert.equal(timezoneOffsetLabel('2026-01-15T00:00:00Z', 'UTC'), 'UTC+0')
  assert.equal(timezoneOffsetLabel('not-a-date', 'Asia/Shanghai'), '')
  assert.equal(timezoneOffsetLabel(null, 'Asia/Shanghai'), '')
})
