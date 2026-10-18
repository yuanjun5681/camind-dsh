// Model preview controls reuse GeomView's camera and selection, without changing geometry.
import React, { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GeomView } from './viewer/geom_view.ts'
const h = React.createElement
export function ModelControls({ view, onReference }: { view: GeomView; onReference?: (fids: string[]) => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([])
  const [input, setInput] = useState(''), [message, setMessage] = useState('')
  const [filter, setFilter] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const types = view.availableSurfaceTypes()
  useEffect(() => {
    const sync = () => setSelected(view.selectedFids())
    view.callbacks.selectionChanged = sync
    sync()
    return () => { if (view.callbacks.selectionChanged === sync) delete view.callbacks.selectionChanged }
  }, [view])
  const select = (event: React.FormEvent) => {
    event.preventDefault()
    const wanted = new Set(input.trim().toUpperCase().split(/[\s,，;；]+/).filter(Boolean))
    const fids = [...wanted]
    const faces = view.facesOf()
    const unknown = fids.filter(fid => !faces.some(face => face.fid === fid))
    const excluded = faces.filter(face => wanted.has(face.fid) && filter.length > 0 && !filter.includes(face.surfaceType))
    const declared = faces.filter((face, index) => wanted.has(face.fid) && view.isDeclaredFace(index))
    if (unknown.length || excluded.length || declared.length) {
      setMessage([unknown.length ? `面编号不存在：${unknown.join('、')}` : '', excluded.length ? `面被类型筛选排除：${excluded.map(face => face.fid).join('、')}` : '', declared.length ? `已声明体（身份匹配）不可选：${declared.map(face => face.fid).join('、')}` : ''].filter(Boolean).join('；'))
      return
    }
    view.setSelectedFids(fids)
    setMessage('')
  }
  const changeFilter = (allowed: string[]) => {
    const next = allowed.length === types.length ? [] : allowed.length ? allowed : ['<none>']
    view.setSurfaceTypeFilter(next)
    setFilter(next); setMessage('')
  }
  return h('section', { className: 'cmv-selection', 'aria-label': '选择面与类型筛选' },
      h('strong', null, `选面与筛选 · 已选 ${selected.length} 面`),
      h('div', { className: 'cmv-selection-body' },
        h('form', { className: 'cmv-face-form', onSubmit: select },
          h(Input, { 'aria-label': '面编号', placeholder: 'F000001，多个编号用空格或逗号分隔', value: input, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value) }),
          h(Button, { type: 'submit' }, '选择'),
          h(Button, { type: 'button', onClick: () => { view.clearSelection(); setInput(''); setMessage('') } }, '清空')),
        onReference ? h(Button, { disabled: !selected.length || adding, onClick: async () => {
          setAdding(true); setMessage('')
          try { await onReference([...selected]); setMessage('已添加到提问草稿，尚未发送。') }
          catch (error: any) { setMessage(error.message) }
          finally { setAdding(false) }
        } }, adding ? '核对引用…' : '添加到提问') : null,
        message ? h('div', { role: message === '已添加到提问草稿，尚未发送。' ? 'status' : 'alert' }, message) : null,
        h('fieldset', null, h('legend', null, '可选曲面类型（其余面压暗）'),
          ...types.map(type => h('label', { key: type }, h('input', { type: 'checkbox', checked: filter.length === 0 || filter.includes(type), onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            const allowed = filter.length === 0 ? types : filter.filter(t => t !== '<none>')
            changeFilter(e.target.checked ? [...allowed, type] : allowed.filter(t => t !== type))
          } }), ` ${type}`)),
          h(Button, { type: 'button', onClick: () => changeFilter(types) }, '全部'),
          h(Button, { type: 'button', onClick: () => changeFilter([]) }, '全不选')),
        h('div', { className: 'cmv-selected', 'aria-live': 'polite' }, selected.length ? selected.map(fid => {
          const face = view.facesOf().find(face => face.fid === fid)!
          return h('div', { key: fid }, `${fid} · ${face.surfaceType} · ${face.areaMm2.toFixed(2)} mm²`)
        }) : '未选面。单击选择，Ctrl/Cmd + 单击增减多选；Esc 退出选择工具。')))
}
