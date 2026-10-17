#include <stdbool.h>
#include <stdint.h>

typedef struct {
    uint32_t window_id;
    uint32_t key_down_count;
    double x;
    double y;
    double width;
    double height;
    double idle_seconds;
} GullbertWorkSample;

bool gullbert_work_sample(GullbertWorkSample *sample);
