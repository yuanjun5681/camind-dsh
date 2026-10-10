import { jsx as _jsx } from "react/jsx-runtime";
import { Route, Routes } from 'react-router-dom';
import { App } from './App';
export function Root() {
    return (_jsx(Routes, { children: _jsx(Route, { path: "*", element: _jsx(App, {}) }) }));
}
