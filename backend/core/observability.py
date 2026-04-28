# backend/core/observability.py
"""
OpenTelemetry Tracing & Metrics Provider for CivicLink.
Provides get_tracer() and get_meter() for distributed tracing across LangGraph, FastAPI, and Celery.
Includes a human-readable console exporter for local development.
"""
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from opentelemetry import trace, metrics
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.trace import Tracer
    from opentelemetry.metrics import Meter
    from opentelemetry.sdk.trace import SpanProcessor
    _HAS_OTEL = True
except ImportError:
    _HAS_OTEL = False
    logger.warning("OpenTelemetry not installed. Observability will run in no-op mode.")

# Global providers
_tracer_provider = None
_meter_provider = None
_initialized = False

# =============================================================================
# HUMAN-READABLE CONSOLE EXPORTER
# =============================================================================
class HumanReadableSpanProcessor(SpanProcessor):
    """
    A custom span processor that prints OpenTelemetry spans as clean, 
    human-readable log statements instead of massive JSON dumps.
    """
    def __init__(self):
        self.logger = logging.getLogger("civiclink.tracer")
        
    def on_start(self, span, parent_context=None):
        pass # We only care about completions for terminal logging
        
    def on_end(self, span):
        # We only want to log the workflow execution spans (LangGraph nodes)
        if span.name != "workflow.execute":
            return
            
        duration_ms = (span.end_time - span.start_time) / 1_000_000
        status = span.attributes.get("workflow.status", "unknown")
        thread_id = span.attributes.get("thread_id", "unknown")
        
        # Extract the node completion events
        nodes_completed = [
            event.name.replace("node.completed.", "").upper() 
            for event in span.events 
            if event.name.startswith("node.completed.")
        ]
        
        if not nodes_completed:
            return
            
        nodes_str = " ➔ ".join(nodes_completed)
        
        if status == "success":
            self.logger.info(f"📊 [TRACE] Thread: {thread_id} | Path: {nodes_str} | Time: {duration_ms:.0f}ms")
        else:
            self.logger.error(f"❌ [TRACE ERROR] Thread: {thread_id} | Failed after: {nodes_str} | Time: {duration_ms:.0f}ms")

    # 🚨 FIX: Required by the newest OpenTelemetry SDK
    def _on_ending(self, span):
        pass

    def force_flush(self, timeout_millis=30000):
        return True

    def shutdown(self):
        pass
# =============================================================================
# SETUP LOGIC
# =============================================================================

def _setup_observability(service_name: str = "civiclink-backend") -> None:
    global _tracer_provider, _meter_provider, _initialized
    if not _HAS_OTEL or _initialized:
        return

    resource = Resource.create({
        "service.name": service_name,
        "environment": os.getenv("ENVIRONMENT", "development"),
        "version": os.getenv("APP_VERSION", "1.0.0"),
        "deployment.environment": os.getenv("DEPLOY_ENV", "local")
    })

    # Initialize Tracer Provider
    _tracer_provider = TracerProvider(resource=resource)
    trace.set_tracer_provider(_tracer_provider)

    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    
    if otlp_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
            from opentelemetry.sdk.trace.export import BatchSpanProcessor
            from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
            from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader

            is_insecure = os.getenv("OTEL_INSECURE", "true").lower() == "true"

            # Traces
            span_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=is_insecure)
            _tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))

            # Metrics
            metric_exporter = OTLPMetricExporter(endpoint=otlp_endpoint, insecure=is_insecure)
            reader = PeriodicExportingMetricReader(metric_exporter, export_interval_millis=5000)
            
            _meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
            logger.info(f"OTLP observability configured at {otlp_endpoint} (Insecure: {is_insecure})")
            
        except Exception as e:
            logger.warning(f"Failed to configure OTLP exporters: {e}. Falling back to readable console.")
            _setup_console_exporters(resource)
    else:
        # Fallback to local human-readable terminal logging
        _setup_console_exporters(resource)

    if not _meter_provider:
        _meter_provider = MeterProvider(resource=resource)
    metrics.set_meter_provider(_meter_provider)

    _initialized = True
    logger.info("Observability providers initialized successfully")


def _setup_console_exporters(resource: Resource) -> None:
    """Fallback for local development to print traces clearly to the terminal."""
    global _tracer_provider
    # 🚨 FIX: Using our Custom Processor instead of the messy JSON ConsoleSpanExporter
    _tracer_provider.add_span_processor(HumanReadableSpanProcessor())
    logger.info("Human-readable terminal traces configured (Local Dev Mode)")


# =============================================================================
# PROVIDER ACCESSORS
# =============================================================================

def get_tracer(name: str) -> Tracer:
    if not _HAS_OTEL:
        class _NoOpTracer:
            def start_as_current_span(self, *args, **kwargs):
                class _NoOpSpan:
                    def __enter__(self): return self
                    def __exit__(self, *args): pass
                    def set_attribute(self, *args): pass
                    def record_exception(self, *args): pass
                    def add_event(self, *args): pass
                return _NoOpSpan()
        return _NoOpTracer()
        
    if not _initialized:
        _setup_observability()
    return trace.get_tracer(name)

def get_meter(name: str) -> Meter:
    if not _HAS_OTEL:
        class _NoOpMeter:
            def create_counter(self, *args, **kwargs):
                class _NoOpCounter:
                    def add(self, *args, **kwargs): pass
                return _NoOpCounter()
            def create_histogram(self, *args, **kwargs):
                class _NoOpHistogram:
                    def record(self, *args, **kwargs): pass
                return _NoOpHistogram()
            def create_gauge(self, *args, **kwargs):
                class _NoOpGauge:
                    def set(self, *args, **kwargs): pass
                return _NoOpGauge()
        return _NoOpMeter()
        
    if not _initialized:
        _setup_observability()
    return metrics.get_meter(name)

def shutdown_observability() -> None:
    global _tracer_provider, _meter_provider
    if _tracer_provider:
        _tracer_provider.shutdown()
    if _meter_provider:
        _meter_provider.shutdown()
    logger.info("Observability providers shut down")