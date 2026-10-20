import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, shots } from './helpers'

test('theme names are Chinese in the Chinese UI and English in the English UI', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-theme-names-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 1, settings: { language: 'zh-CN' }, tasks: [] })
  )
  const { app, page } = await launch(userData)
  await page.locator('aside').getByRole('button', { name: '主题' }).click()
  for (const [id, name] of [
    ['classic', '经典'],
    ['enhanced', '增强'],
    ['legendary', '传奇'],
    ['custom', '自定义']
  ] as const) {
    await expect(page.getByTestId(`theme-${id}`)).toContainText(name)
  }
  await expect(page.getByRole('heading', { name: '自定义主题' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText(/Classic|Enhanced|Legendary|Custom/)
  // Default selection and stored ids unchanged
  await expect(page.getByTestId('theme-legendary')).toContainText('使用中')
  const settings = await page.evaluate(() => window.lifeUnlocked.settings.get())
  expect(settings.achievementTheme).toBe('legendary')
  await page.screenshot({ path: path.join(shots, 'themes-zh.png') })

  // New-task dialog lists the same names
  await page.locator('aside').getByRole('button', { name: '任务' }).click()
  await page.getByRole('button', { name: '新建任务' }).first().click()
  await expect(page.getByRole('dialog')).toContainText('使用全局主题（传奇）')
  await page.keyboard.press('Escape')

  await page.evaluate(() => window.lifeUnlocked.settings.update({ language: 'en' }))
  await page.locator('aside').getByRole('button', { name: 'Themes' }).click()
  await expect(page.getByTestId('theme-classic')).toContainText('Classic')
  await expect(page.getByTestId('theme-custom')).toContainText('Custom')
  await app.close()
})
