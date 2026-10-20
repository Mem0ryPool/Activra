import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch } from './helpers'

const openAccount = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /Settings|设置/ }).click()
  await expect(page.getByTestId('account-section')).toHaveAttribute('data-auth-state', 'signed-out')
}

test('optional email sign-in: development mock, no token in the page, local data untouched', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-auth-'))
  let { app, page } = await launch(userData)
  await openAccount(page)
  const account = page.getByTestId('account-section')
  await expect(page.getByTestId('account-dev-note')).toBeVisible()
  const dataFile = path.join(userData, 'life-unlocked-data.json')
  const dataBefore = await readFile(dataFile, 'utf8').catch(() => null)

  // Client-side checks, keyboard only (Enter submits).
  const email = page.locator('#account-email')
  await email.fill('13800138000')
  await email.press('Enter')
  await expect(account.getByRole('alert')).toHaveText(/Phone sign-in is not available|暂不支持手机号登录/)
  await email.fill('me@example')
  await email.press('Enter')
  await expect(account.getByRole('alert')).toHaveText(/valid email|有效的邮箱/)

  await email.fill('Me@Example.test')
  await email.press('Enter')
  await expect(account).toHaveAttribute('data-auth-state', 'code-sent')
  const codeInput = page.locator('#account-code')
  await expect(codeInput).toBeFocused()
  const code = ((await page.getByTestId('account-dev-code').textContent()) ?? '').match(/\d{6}/)?.[0] as string
  expect(code).toMatch(/^\d{6}$/)
  await expect(page.getByTestId('account-resend')).toBeDisabled()

  await codeInput.fill(String((Number(code) + 1) % 1_000_000).padStart(6, '0'))
  await codeInput.press('Enter')
  await expect(account.getByRole('alert')).toHaveText(/wrong or has expired|错误或已过期/)
  await codeInput.fill(code)
  await codeInput.press('Enter')
  await expect(account).toHaveAttribute('data-auth-state', 'signed-in')
  await expect(page.getByTestId('account-signed-in')).toContainText('Me@example.test')

  // Nothing about the session is kept in the page's storage; the session file holds only ciphertext.
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toMatch(/token|example\.test/i)
  const sessionFile = await readFile(path.join(userData, 'auth-session.json'), 'utf8')
  expect(sessionFile).not.toMatch(/Token|example\.test/)

  // The session survives a restart; signing in and out never rewrote the data file.
  await app.close()
  ;({ app, page } = await launch(userData))
  await page.getByRole('button', { name: /Settings|设置/ }).click()
  await expect(page.getByTestId('account-section')).toHaveAttribute('data-auth-state', 'signed-in')
  await page.getByTestId('account-sign-out').click()
  await expect(page.getByTestId('account-section')).toHaveAttribute('data-auth-state', 'signed-out')
  expect(await readdir(userData)).not.toContain('auth-session.json')
  expect(await readFile(dataFile, 'utf8').catch(() => null)).toBe(dataBefore)
  await app.close()
})
