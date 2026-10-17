// Client entry for the drawing preview plugin. M1-03 replaces this placeholder with the
// descriptor-to-DraftPane v2 adapter and the cam.drawing.preview slot registration.
import React from 'react'

export function DrawingPreview(): React.ReactElement {
  return React.createElement('div', { className: 'cdv-pending' }, 'Draft 核心镜像尚未接入')
}

export const name = 'camind-ui-drawing-viewer'
export const inject = ['slots']
export function apply(): void {}
