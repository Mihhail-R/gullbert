use std::{collections::VecDeque, sync::Mutex};

// An effect can pump messages and reenter a shortcut callback. Queue that work
// until the current lifecycle finishes, without holding a lock across effects.
pub(super) struct Queue<T> {
    state: Mutex<QueueState<T>>,
}
struct QueueState<T> {
    running: bool,
    pending: VecDeque<T>,
}
impl<T> Default for Queue<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new(QueueState {
                running: false,
                pending: VecDeque::new(),
            }),
        }
    }
}
impl<T> Queue<T> {
    pub(super) fn run(&self, job: T, mut execute: impl FnMut(T)) {
        if !self.push(job) {
            return;
        }
        while let Some(job) = self.next() {
            execute(job);
        }
    }

    fn push(&self, job: T) -> bool {
        let mut state = self.state.lock().unwrap();
        state.pending.push_back(job);
        if state.running {
            false
        } else {
            state.running = true;
            true
        }
    }
    fn next(&self) -> Option<T> {
        let mut state = self.state.lock().unwrap();
        let next = state.pending.pop_front();
        if next.is_none() {
            state.running = false;
        }
        next
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    #[test]
    fn reentrant_effects_finish_before_queued_escape_and_later_work_still_runs() {
        type Job = Box<dyn FnOnce()>;
        let queue = Rc::new(Queue::<Job>::default());
        let trace = Rc::new(RefCell::new(Vec::new()));
        let nested_queue = queue.clone();
        let current_trace = trace.clone();
        queue.run(
            Box::new(move || {
                current_trace.borrow_mut().push("register Escape");
                let nested_trace = current_trace.clone();
                // Simulate an OS call pumping an Escape callback while registering.
                nested_queue.run(
                    Box::new(move || nested_trace.borrow_mut().push("handle Escape")),
                    |job| job(),
                );
                current_trace.borrow_mut().push("finish capture");
            }),
            |job| job(),
        );
        let later_trace = trace.clone();
        queue.run(
            Box::new(move || later_trace.borrow_mut().push("replacement")),
            |job| job(),
        );
        assert_eq!(
            *trace.borrow(),
            [
                "register Escape",
                "finish capture",
                "handle Escape",
                "replacement"
            ]
        );
    }
}
