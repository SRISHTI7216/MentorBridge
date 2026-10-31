import React, { useState } from 'react';
import { MOCK_CODING_CHALLENGES } from '../../services/mockData';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const StudentCoding: React.FC = () => {
  const [selectedChallenge, setSelectedChallenge] = useState(MOCK_CODING_CHALLENGES[0]);
  const [code, setCode] = useState(`// Solution for: ${selectedChallenge.title}
// Language: C++20 / Java / Python / TypeScript
#include <iostream>
#include <unordered_map>
using namespace std;

class LRUCache {
private:
    int capacity;
public:
    LRUCache(int cap) : capacity(cap) {
        // Initialize doubly-linked list & hash map
    }

    int get(int key) {
        // Return value or -1 if not found
        return -1;
    }

    void put(int key, int value) {
        // Insert or update key-value pair
    }
};

int main() {
    cout << "Testing LRU Cache..." << endl;
    return 0;
}`);

  const [activeConsoleTab, setActiveConsoleTab] = useState<'testcases' | 'output'>('testcases');
  const [isRunning, setIsRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);

  const handleRunCode = () => {
    setIsRunning(true);
    setRunOutput(null);
    setTimeout(() => {
      setIsRunning(false);
      setActiveConsoleTab('output');
      setRunOutput(`> Compiling and running test suite...
[TEST 1] Input: LRUCache(2), put(1, 1), put(2, 2), get(1) -> Output: 1 [PASSED] (2ms)
[TEST 2] Input: put(3, 3), get(2) -> Output: -1 [PASSED] (1ms)
[TEST 3] Input: put(4, 4), get(1), get(3), get(4) -> Output: -1, 3, 4 [PASSED] (2ms)

All 3 local test cases passed!
Memory used: 14.2 MB | Runtime: 5ms (Faster than 88.4% of submissions)`);
    }, 800);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface h-[calc(100vh-53px)]">
      {/* Top Workspace Header Bar */}
      <div className="bg-surface-container-lowest border-b border-outline-variant px-6 py-2.5 flex items-center justify-between z-20 shrink-0 text-xs">
        <div className="flex items-center gap-3">
          <Badge
            variant={
              selectedChallenge.difficulty === 'Easy'
                ? 'success'
                : selectedChallenge.difficulty === 'Medium'
                ? 'warning'
                : 'error'
            }
          >
            {selectedChallenge.difficulty}
          </Badge>
          <h1 className="font-bold text-slate-900 text-sm">{selectedChallenge.title}</h1>
          <span className="text-slate-300 hidden sm:inline">|</span>
          <span className="text-slate-500 font-mono hidden sm:inline">{selectedChallenge.category}</span>
        </div>

        <div className="flex items-center gap-2">
          <select className="bg-surface border border-outline-variant rounded-lg px-2 py-1 text-xs font-mono font-semibold cursor-pointer">
            <option>C++ (GCC 13.2)</option>
            <option>Python 3.12</option>
            <option>Java 21</option>
            <option>TypeScript 5.6</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={isRunning}
            onClick={handleRunCode}
            leftIcon={<span className="material-symbols-outlined text-sm">play_arrow</span>}
          >
            Run Tests
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={isRunning}
            onClick={() => alert('Code submission queued for automated evaluation (Phase 1 mock).')}
            leftIcon={<span className="material-symbols-outlined text-sm">cloud_upload</span>}
          >
            Submit Code
          </Button>
        </div>
      </div>

      {/* Main Split IDE Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
        {/* Left Column: Problem Description & Challenge Selector (4 Cols) */}
        <div className="lg:col-span-4 border-r border-outline-variant bg-surface-container-lowest p-5 overflow-y-auto space-y-4 text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-bold text-slate-900 text-sm">Problem Description</h2>
            <span className="text-[10px] text-slate-400 font-mono">ID: {selectedChallenge.id}</span>
          </div>

          <div className="space-y-3 leading-relaxed text-slate-700">
            <p>
              Design a data structure that follows the constraints of a <strong>Least Recently Used (LRU) cache</strong>.
            </p>
            <p>Implement the <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-primary font-semibold">LRUCache</code> class:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><code className="font-mono">LRUCache(int capacity)</code> Initialize the LRU cache with positive size capacity.</li>
              <li><code className="font-mono">int get(int key)</code> Return the value of the key if the key exists, otherwise return -1.</li>
              <li><code className="font-mono">void put(int key, int value)</code> Update the value of the key if key exists. Otherwise, add the key-value pair to the cache.</li>
            </ul>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 font-mono text-[11px]">
            <p className="font-bold text-slate-800">Complexity Constraints:</p>
            <p>Time: O(1) for both get and put operations</p>
            <p>Space: O(capacity)</p>
          </div>

          {/* Quick Problem List */}
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <h3 className="font-bold text-slate-900 text-xs">Other Recommended Problems</h3>
            <div className="space-y-1.5">
              {MOCK_CODING_CHALLENGES.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setSelectedChallenge(ch)}
                  className={`w-full text-left p-2 rounded-lg transition-colors flex items-center justify-between ${
                    selectedChallenge.id === ch.id
                      ? 'bg-indigo-50 border border-indigo-200 text-primary font-semibold'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span className="truncate pr-2">{ch.title}</span>
                  <span className="text-[10px] uppercase font-mono shrink-0">{ch.difficulty}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Code Editor & Console (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col bg-slate-950 text-slate-200 min-h-0 overflow-hidden">
          {/* Editor Header Bar */}
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2 text-slate-400">
              <span className="material-symbols-outlined text-sm">code</span>
              <span>solution.cpp</span>
            </div>
            <span className="text-[10px] text-slate-500">Auto-save enabled (Local)</span>
          </div>

          {/* Code Textarea / Editor Frame */}
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full h-full bg-transparent text-slate-100 resize-none outline-none font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
          </div>

          {/* Bottom Console Panel */}
          <div className="h-44 border-t border-slate-800 bg-slate-900/90 flex flex-col shrink-0 text-xs">
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setActiveConsoleTab('testcases')}
                  className={`py-1 font-semibold transition-colors ${
                    activeConsoleTab === 'testcases' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-400'
                  }`}
                >
                  Test Cases (3)
                </button>
                <button
                  onClick={() => setActiveConsoleTab('output')}
                  className={`py-1 font-semibold transition-colors ${
                    activeConsoleTab === 'output' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-400'
                  }`}
                >
                  Execution Output
                </button>
              </div>
              {isRunning && (
                <span className="text-[11px] text-indigo-400 animate-pulse flex items-center gap-1 font-mono">
                  <span className="material-symbols-outlined text-xs animate-spin">progress_activity</span>
                  Running sandboxed compiler...
                </span>
              )}
            </div>

            <div className="p-3 overflow-y-auto font-mono text-[11px] flex-1 text-slate-300">
              {activeConsoleTab === 'testcases' ? (
                <div className="space-y-1.5">
                  <p className="text-slate-400">Case 1: ["LRUCache", "put", "put", "get", "put", "get", "put", "get", "get", "get"]</p>
                  <p className="text-slate-400">Inputs: [[2], [1, 1], [2, 2], [1], [3, 3], [2], [4, 4], [1], [3], [4]]</p>
                  <p className="text-emerald-400">Expected: [null, null, null, 1, null, -1, null, -1, 3, 4]</p>
                </div>
              ) : (
                <pre className="text-slate-200 whitespace-pre-wrap">{runOutput || "Click 'Run Tests' to execute code against compiler sandbox."}</pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
